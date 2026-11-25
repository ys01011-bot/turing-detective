// 튜링 탐정단 서버 진입점: Express(정적 파일) + Socket.IO(실시간)
require('dotenv').config();
const path = require('path');
const os = require('os');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const QRCode = require('qrcode');

const R = require('./room');
const G = require('./game');
const { classifyRoom, LABELS } = require('./classify');
const ai = require('./ai');

// 놀이가 멈추지 않게: 처리 중 오류가 나도 서버는 계속 돈다
process.on('unhandledRejection', (e) => console.error('[오류]', e));
process.on('uncaughtException', (e) => console.error('[오류]', e));

const PORT = Number(process.env.PORT) || 3000;
const TEACHER_PIN = (process.env.TEACHER_PIN || '').trim() || '0000';
if (!process.env.TEACHER_PIN) console.warn('[주의] TEACHER_PIN 이 없어 개발용 기본 PIN 0000 을 씁니다. 수업 전에 .env 에 꼭 설정하세요.');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { pingInterval: 10000, pingTimeout: 8000 });

const PUB = path.join(__dirname, '..', 'public');
app.use(express.static(PUB, { extensions: ['html'] }));
app.get('/teacher', (req, res) => res.sendFile(path.join(PUB, 'teacher.html')));

// 학생 입장 전 방 확인 (모둠 수, 모둠별 인원)
app.get('/api/room/:code', (req, res) => {
  const room = R.getRoom(req.params.code);
  if (!room) return res.status(404).json({ ok: false, msg: '방을 찾을 수 없어요. 방 코드를 다시 확인해 주세요.' });
  res.json({
    ok: true,
    groups: room.groups.map((g) => ({ idx: g.idx, count: g.playerIds.length, open: g.state === 'LOBBY' })),
    groupSize: room.settings.groupSize,
  });
});

// 주제 세트 목록 (교사 T1 방 만들기용, 질문만)
app.get('/content/sets', (req, res) => {
  res.json(require('./content').topicSets().sets.map((s) => ({ id: s.id, title: s.title, rounds: s.rounds.map((r) => ({ question: r.question, clue: r.clue })) })));
});

// 방 코드 QR (SVG)
app.get('/api/qr', async (req, res) => {
  try {
    const svg = await QRCode.toString(String(req.query.text || '').slice(0, 300), { type: 'svg', margin: 1, color: { dark: '#3b3a5a', light: '#ffffff' } });
    res.type('image/svg+xml').send(svg);
  } catch (e) {
    res.status(400).end();
  }
});

// 같은 와이파이의 크롬북이 접속할 주소 후보
app.get('/api/addresses', (req, res) => {
  const list = [];
  for (const ifs of Object.values(os.networkInterfaces())) {
    for (const i of ifs || []) if (i.family === 'IPv4' && !i.internal) list.push(`http://${i.address}:${PORT}`);
  }
  res.json(list);
});

// ── 상태 보내기 ─────────────────────────────────────
const teacherTimers = new Map();
const hub = {
  emitGroup(room, g) {
    for (const id of g.playerIds) {
      const p = room.players.get(id);
      if (p) io.to('p:' + id).emit('state', R.studentState(room, p));
    }
  },
  // 교사 화면은 0.25초에 한 번으로 묶어서 보낸다
  emitTeacher(room) {
    if (teacherTimers.has(room.code)) return;
    teacherTimers.set(
      room.code,
      setTimeout(() => {
        teacherTimers.delete(room.code);
        if (R.rooms.has(room.code)) io.to('t:' + room.code).emit('room-state', R.teacherState(room));
      }, 250)
    );
  },
  typing(room, g, playerId) {
    io.to(`g:${room.code}:${g.idx}`).emit('typing', { playerId, nick: room.players.get(playerId)?.nick });
  },
};
G.setHub(hub);

function emitPlayer(room, p) {
  io.to('p:' + p.id).emit('state', R.studentState(room, p));
}

function bindStudent(socket, room, p) {
  socket.data.code = room.code;
  socket.data.playerId = p.id;
  socket.join('p:' + p.id);
  socket.join(`g:${room.code}:${p.groupIdx}`);
  p.sockets = (p.sockets || 0) + 1;
  p.connected = true;
  p.disconnectedAt = null;
  p.lastSeen = Date.now();
}

const ctx = (socket) => {
  const room = R.getRoom(socket.data.code);
  const p = room && room.players.get(socket.data.playerId);
  return p ? { room, p, g: room.groups[p.groupIdx] } : null;
};

const NICK_RE = /^[\p{L}\p{N} _-]{2,8}$/u;

io.on('connection', (socket) => {
  const reply = (cb, v) => typeof cb === 'function' && cb(v);

  // ── 학생 ──
  socket.on('join', ({ code, nick, groupIdx } = {}, cb) => {
    const room = R.getRoom(code);
    if (!room) return reply(cb, { ok: false, msg: '방을 찾을 수 없어요.' });
    nick = String(nick || '').replace(/\s+/g, ' ').trim();
    if (!NICK_RE.test(nick)) return reply(cb, { ok: false, msg: '별명은 2~8자 글자·숫자로 써 주세요.' });
    const g = room.groups[Number(groupIdx)];
    if (!g) return reply(cb, { ok: false, msg: '모둠을 골라 주세요.' });
    const same = g.playerIds.map((id) => room.players.get(id)).find((x) => x.nick === nick);
    if (same) {
      // 같은 모둠·같은 별명이 연결이 끊긴 상태면 그 자리로 복귀 (기기를 바꾼 경우)
      if (same.connected) return reply(cb, { ok: false, msg: '모둠에 같은 별명이 있어요. 다른 별명을 써 주세요.' });
      bindStudent(socket, room, same);
      reply(cb, { ok: true, playerId: same.id, code: room.code });
      emitPlayer(room, same);
      hub.emitGroup(room, g);
      hub.emitTeacher(room);
      return;
    }
    if (g.state !== 'LOBBY') return reply(cb, { ok: false, msg: '이 모둠은 이미 게임을 시작했어요. 선생님께 말해 주세요.' });
    if (g.playerIds.length >= 7) return reply(cb, { ok: false, msg: '이 모둠은 자리가 꽉 찼어요.' });
    const p = R.addPlayer(room, { nick, groupIdx: g.idx });
    bindStudent(socket, room, p);
    reply(cb, { ok: true, playerId: p.id, code: room.code });
    hub.emitGroup(room, g);
    hub.emitTeacher(room);
  });

  socket.on('resume', ({ code, playerId } = {}, cb) => {
    const room = R.getRoom(code);
    const p = room && room.players.get(playerId);
    if (!p) return reply(cb, { ok: false });
    bindStudent(socket, room, p);
    reply(cb, { ok: true });
    const g = room.groups[p.groupIdx];
    hub.emitGroup(room, g);
    hub.emitTeacher(room);
  });

  socket.on('greeting', async ({ text } = {}, cb) => {
    const c = ctx(socket);
    if (!c) return reply(cb, { ok: false });
    reply(cb, await G.setGreeting(c.room, c.p, text));
  });

  socket.on('poll', ({ which, choice } = {}, cb) => {
    const c = ctx(socket);
    if (!c) return reply(cb, { ok: false });
    const i = Number(choice);
    if (!(i >= 0 && i <= 2)) return reply(cb, { ok: false });
    if (which === 'post') c.p.postPoll = i;
    else c.p.prePoll = i;
    emitPlayer(c.room, c.p);
    hub.emitTeacher(c.room);
    reply(cb, { ok: true });
  });

  socket.on('pledge', ({ text } = {}, cb) => {
    const c = ctx(socket);
    if (!c) return reply(cb, { ok: false });
    const t = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 100);
    if (t.length < 2) return reply(cb, { ok: false, msg: '약속을 한 줄 써 주세요.' });
    const { findBanned } = require('./pipeline');
    if (findBanned(t).length) return reply(cb, { ok: false, msg: '다시 써 주세요.' });
    c.p.pledge = t;
    emitPlayer(c.room, c.p);
    hub.emitTeacher(c.room);
    reply(cb, { ok: true });
  });

  socket.on('ack-role', () => {
    const c = ctx(socket);
    if (c) G.ackRole(c.room, c.g, c.p);
  });

  socket.on('typing', (data) => {
    const c = ctx(socket);
    if (c) G.onTyping(c.room, c.g, c.p, data || {});
  });

  socket.on('send', async ({ text } = {}, cb) => {
    const c = ctx(socket);
    if (!c) return reply(cb, { ok: false });
    reply(cb, await G.send(c.room, c.g, c.p, text));
  });

  socket.on('vote', ({ targetId, reason } = {}, cb) => {
    const c = ctx(socket);
    if (!c) return reply(cb, { ok: false });
    reply(cb, G.vote(c.room, c.g, c.p, targetId, reason));
  });

  socket.on('leave', () => {
    // 학생이 '나가기'를 누른 경우: 대기실에서만 자리 비움
    const c = ctx(socket);
    if (c && c.g.state === 'LOBBY') {
      R.removePlayer(c.room, c.p.id);
      hub.emitGroup(c.room, c.g);
      hub.emitTeacher(c.room);
    }
    socket.data.playerId = null;
  });

  socket.on('disconnect', () => {
    const c = ctx(socket);
    if (c) {
      c.p.sockets = Math.max(0, (c.p.sockets || 1) - 1);
      if (c.p.sockets === 0) {
        c.p.connected = false;
        c.p.disconnectedAt = Date.now();
        hub.emitGroup(c.room, c.g);
        hub.emitTeacher(c.room);
      }
    }
  });

  // ── 교사 ──
  socket.on('teacher-auth', ({ pin } = {}, cb) => {
    if (String(pin || '') !== TEACHER_PIN) return reply(cb, { ok: false, msg: 'PIN이 맞지 않아요.' });
    socket.data.teacher = true;
    reply(cb, { ok: true, provider: ai.providerName, defaults: R.DEFAULT_SETTINGS });
  });

  const T = (handler) => async (data = {}, cb) => {
    if (!socket.data.teacher) return reply(cb, { ok: false, msg: '교사 로그인이 필요해요.' });
    const room = data.code ? R.getRoom(data.code) : null;
    try {
      reply(cb, (await handler(room, data)) || { ok: true });
    } catch (e) {
      console.error(e);
      reply(cb, { ok: false, msg: '처리 중 문제가 생겼어요.' });
    }
  };
  const needRoom = (fn) => (room, data) => (room ? fn(room, data) : { ok: false, msg: '방이 없어요.' });
  const groupsOf = (room, data) => (data.groupIdx === 'all' || data.groupIdx === undefined ? room.groups : [room.groups[Number(data.groupIdx)]].filter(Boolean));

  socket.on(
    'create-room',
    T((_, data) => {
      const room = R.createRoom({ groupCount: data.groupCount, settings: data.settings, gameCfg: data.gameCfg });
      socket.join('t:' + room.code);
      socket.emit('room-state', R.teacherState(room));
      return { ok: true, code: room.code };
    })
  );

  socket.on(
    'watch-room',
    T(
      needRoom((room) => {
        socket.join('t:' + room.code);
        socket.emit('room-state', R.teacherState(room));
        return { ok: true, code: room.code };
      })
    )
  );

  socket.on(
    'update-settings',
    T(
      needRoom((room, data) => {
        const started = room.groups.some((g) => g.game > 0);
        const s = R.sanitizeSettings({ ...room.settings, ...(data.settings || {}) });
        if (started) {
          // 시작 뒤에는 판 수·바퀴 수는 바꾸지 않는다
          s.games = room.settings.games;
          s.rounds = room.settings.rounds;
        }
        room.settings = s;
        if (Array.isArray(data.gameCfg)) {
          data.gameCfg.forEach((c, i) => {
            if (!room.gameCfg[i] || !c) return;
            const g0 = room.groups.some((g) => g.game > i); // 이미 시작한 판은 바꾸지 않음
            if (g0) return;
            room.gameCfg[i] = {
              setId: c.setId || room.gameCfg[i].setId,
              custom: Array.isArray(c.custom) ? c.custom.map((x) => ({ question: String(x.question || '').slice(0, 80), clue: x.clue })) : null,
            };
          });
        }
        hub.emitTeacher(room);
        for (const g of room.groups) hub.emitGroup(room, g);
      })
    )
  );

  socket.on(
    'start-game',
    T(
      needRoom((room, data) => {
        const msgs = [];
        for (const g of groupsOf(room, data)) {
          const r = G.startGame(room, g);
          if (!r.ok) msgs.push(r.msg);
        }
        return { ok: msgs.length === 0, msg: msgs.join('\n') };
      })
    )
  );

  socket.on(
    'pause',
    T(
      needRoom((room, data) => {
        for (const g of groupsOf(room, data)) G.setPaused(room, g, !!data.paused);
      })
    )
  );

  socket.on('redo-turn', T(needRoom((room, data) => G.redoTurn(room, room.groups[data.groupIdx]))));
  socket.on('skip-turn', T(needRoom((room, data) => G.skipTurn(room, room.groups[data.groupIdx]))));
  socket.on('force-backup', T(needRoom((room, data) => G.forceBackup(room, room.groups[data.groupIdx]))));
  socket.on(
    'end-vote',
    T(
      needRoom((room, data) => {
        G.finishVoting(room, room.groups[data.groupIdx]);
      })
    )
  );

  socket.on(
    'move-player',
    T(
      needRoom((room, data) => {
        const p = room.players.get(data.playerId);
        if (!p) return { ok: false, msg: '학생이 없어요.' };
        const from = room.groups[p.groupIdx];
        const to = room.groups[Number(data.toIdx)];
        if (!to || from.state !== 'LOBBY' || to.state !== 'LOBBY') return { ok: false, msg: '대기실에서만 모둠을 옮길 수 있어요.' };
        if (to.playerIds.some((id) => room.players.get(id).nick === p.nick)) return { ok: false, msg: '옮길 모둠에 같은 별명이 있어요.' };
        io.in('p:' + p.id).socketsLeave(`g:${room.code}:${from.idx}`);
        R.movePlayer(room, p.id, to.idx);
        io.in('p:' + p.id).socketsJoin(`g:${room.code}:${to.idx}`);
        hub.emitGroup(room, from);
        hub.emitGroup(room, to);
        hub.emitTeacher(room);
      })
    )
  );

  socket.on(
    'kick-player',
    T(
      needRoom((room, data) => {
        const p = room.players.get(data.playerId);
        if (!p) return { ok: false, msg: '학생이 없어요.' };
        const g = room.groups[p.groupIdx];
        if (g.state !== 'LOBBY' && g.state !== 'RESULT') return { ok: false, msg: '대기실이나 결과 화면에서만 내보낼 수 있어요.' };
        io.to('p:' + p.id).emit('kicked');
        io.in('p:' + p.id).socketsLeave(`g:${room.code}:${g.idx}`);
        R.removePlayer(room, p.id);
        hub.emitGroup(room, g);
        hub.emitTeacher(room);
      })
    )
  );

  socket.on('closing', T(needRoom((room) => G.startClosing(room))));

  socket.on(
    'set-label',
    T(
      needRoom((room, data) => {
        const e = room.evidence.find((x) => x.id === data.id);
        if (!e || ![...LABELS, 'unclassified'].includes(data.label)) return { ok: false };
        e.label = data.label;
        hub.emitTeacher(room);
      })
    )
  );

  socket.on(
    'toggle-best',
    T(
      needRoom((room, data) => {
        const e = room.evidence.find((x) => x.id === data.id);
        if (!e) return { ok: false };
        e.best = !e.best;
        hub.emitTeacher(room);
      })
    )
  );

  socket.on(
    'classify',
    T(
      needRoom(async (room) => {
        await classifyRoom(room);
        hub.emitTeacher(room);
      })
    )
  );

  socket.on('dismiss-alert', T(needRoom((room, data) => {
    room.alerts = room.alerts.filter((a) => a.id !== data.id);
    hub.emitTeacher(room);
  })));

  socket.on(
    'close-room',
    T(
      needRoom((room) => {
        io.to('t:' + room.code).emit('room-closed');
        for (const p of room.players.values()) io.to('p:' + p.id).emit('room-closed');
        R.deleteRoom(room.code);
        return { ok: true };
      })
    )
  );
});

server.listen(PORT, () => {
  console.log(`튜링 탐정단 서버가 켜졌어요 (AI: ${ai.providerName})`);
  console.log(`  학생 화면: http://localhost:${PORT}/`);
  console.log(`  교사 화면: http://localhost:${PORT}/teacher`);
});
