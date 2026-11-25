// AI 에이전트(사람 역할 시험 플레이어)용 다리.
// 상주 프로세스가 학생 자리를 지키고, 에이전트는 짧은 명령으로 읽고 보낸다.
//
//   node scripts/agent-player.js daemon --url URL --code 264684 --group 0 --nick 하람 --dir D
//   node scripts/agent-player.js wait   --dir D [--timeout 100]   ← 할 일이 생길 때까지 기다렸다가 상황을 보여 줌
//   node scripts/agent-player.js greet  --dir D "오늘 기분 한 줄"
//   node scripts/agent-player.js say    --dir D "채팅 한 줄"
//   node scripts/agent-player.js vote   --dir D 별명 "근거"
//   node scripts/agent-player.js poll   --dir D pre|post 0|1|2
//   node scripts/agent-player.js pledge --dir D "약속 한 줄"
//   node scripts/agent-player.js status --dir D
// 마피아가 되면 '타이핑하는 척'과 전송은 상주 프로세스가 알아서 한다.
const fs = require('fs');
const path = require('path');

const argv = process.argv.slice(2);
const cmd = argv[0];
const opt = {};
const rest = [];
for (let i = 1; i < argv.length; i++) {
  if (argv[i].startsWith('--')) opt[argv[i].slice(2)] = argv[++i];
  else rest.push(argv[i]);
}
const DIR = opt.dir;
if (!DIR) {
  console.error('--dir 이 필요해요');
  process.exit(2);
}
fs.mkdirSync(path.join(DIR, 'cmd'), { recursive: true });
const F = {
  state: path.join(DIR, 'state.json'),
  seen: path.join(DIR, 'seen.json'),
  log: path.join(DIR, 'daemon.log'),
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const readJSON = (f, d) => {
  try {
    return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch (e) {
    return d;
  }
};
const writeJSON = (f, v) => {
  const tmp = f + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(v));
  fs.renameSync(tmp, f);
};

// ── 상주 프로세스 ─────────────────────────────────────
async function daemon() {
  const { io } = require('socket.io-client');
  const log = (...a) => fs.appendFileSync(F.log, new Date().toISOString().slice(11, 19) + ' ' + a.join(' ') + '\n');
  const s = io(opt.url, { transports: ['websocket'] });
  let me = { id: null };
  let st = null;
  let ghostBusy = null;
  const ackOnce = new Set();

  s.on('connect', () => {
    if (me.id) s.emit('resume', { code: opt.code, playerId: me.id }, () => {});
    else
      s.emit('join', { code: opt.code, nick: opt.nick, groupIdx: Number(opt.group || 0) }, (r) => {
        if (!r || !r.ok) {
          log('입장 실패', r && r.msg);
          writeJSON(F.state, { error: (r && r.msg) || '입장 실패' });
          return;
        }
        me.id = r.playerId;
        log('입장', opt.nick, me.id);
      });
  });
  s.on('disconnect', () => log('연결 끊김'));
  s.on('state', async (x) => {
    st = x;
    writeJSON(F.state, { ...x, savedAt: Date.now() });
    const g = x.group;
    // 역할 확인은 자동
    if (g.state === 'ROLE_REVEAL' && !x.me.acked && !ackOnce.has(g.game)) {
      ackOnce.add(g.game);
      await sleep(1500 + Math.random() * 1500);
      s.emit('ack-role');
    }
    // 마피아 차례: 사람처럼 키를 눌러 AI 문장을 채우고 보낸다
    if (x.ghost && x.ghost.text && ghostBusy !== x.ghost.turnId) {
      ghostBusy = x.ghost.turnId;
      const n = [...x.ghost.text].length;
      await sleep(1500 + Math.random() * 2000);
      for (let p = 0; p <= n; p += 1 + (Math.random() < 0.5 ? 1 : 0)) {
        s.emit('typing', { pos: Math.min(p, n) });
        await sleep(150 + Math.random() * 200);
      }
      s.emit('typing', { pos: n });
      await sleep(600);
      s.emit('send', {}, (r) => log('마피아 전송', r && r.ok ? '성공' : r && r.msg));
    } else if (x.ghost && !x.ghost.text) {
      s.emit('typing', { pos: 0 });
    }
  });

  // 명령 처리
  const done = new Set();
  for (;;) {
    await sleep(250);
    let files = [];
    try {
      files = fs.readdirSync(path.join(DIR, 'cmd')).filter((f) => f.endsWith('.json') && !f.endsWith('.result.json'));
    } catch (e) {}
    for (const f of files) {
      if (done.has(f)) continue;
      done.add(f);
      const c = readJSON(path.join(DIR, 'cmd', f), null);
      const out = path.join(DIR, 'cmd', f.replace(/\.json$/, '.result.json'));
      if (!c) continue;
      const reply = (r) => writeJSON(out, r || { ok: false, msg: '응답 없음' });
      const nickToId = (nick) => st && st.group.members.find((m) => m.nick === nick)?.id;
      if (c.type === 'say') {
        // 사람처럼 몇 글자씩 입력 중 표시 후 전송
        const t = String(c.text || '');
        for (let i = 3; i < t.length; i += 4) {
          s.emit('typing', { draft: t.slice(0, i) });
          await sleep(120);
        }
        s.emit('send', { text: t }, reply);
      } else if (c.type === 'greet') s.emit('greeting', { text: c.text }, reply);
      else if (c.type === 'vote') {
        const id = nickToId(c.target);
        if (!id) reply({ ok: false, msg: `그런 별명이 없어요: ${c.target}` });
        else s.emit('vote', { targetId: id, reason: c.reason }, reply);
      } else if (c.type === 'poll') s.emit('poll', { which: c.which, choice: Number(c.choice) }, reply);
      else if (c.type === 'pledge') s.emit('pledge', { text: c.text }, reply);
      else reply({ ok: false, msg: '모르는 명령' });
      log('명령', c.type, JSON.stringify(c).slice(0, 120));
    }
  }
}

// ── 에이전트용 명령 ───────────────────────────────────
function summary(st, seen) {
  const g = st.group;
  const L = [];
  const role = st.me.role === 'mafia' ? '마피아(AI가 대신 말함, 너는 사람인 척 버티기)' : st.me.role === 'human' ? '사람(숨은 AI 찾기)' : '아직 없음';
  L.push(`[나] ${st.me.nick} / 역할: ${role} / 점수 ${st.me.score}`);
  L.push(`[상태] ${g.game}판 ${g.round}바퀴 / ${g.state}${g.paused ? ' (일시정지)' : ''} / 남은 시간 ${Math.max(0, Math.round((g.remainingMs || 0) / 1000))}초`);
  L.push(`[모둠원] ${g.members.map((m) => m.nick + (m.connected ? '' : '(끊김)')).join(', ')}`);
  if (g.greetings.length) L.push('[입장 인사]\n' + g.greetings.map((x) => `  ${x.nick}: ${x.text}`).join('\n'));
  if (g.question) L.push(`[이번 판 질문] ${g.question}${g.guide ? ' — ' + g.guide : ''}`);
  if (g.messages.length) L.push('[이번 판 대화]\n' + g.messages.map((m) => `  (${m.round}바퀴) ${m.nick}: ${m.pass ? '(패스)' : m.text}`).join('\n'));
  if (g.turn) L.push(`[차례] ${g.turn.nick} (${g.turn.idx + 1}/${g.turn.of})`);
  if (g.result) {
    const r = g.result;
    L.push(
      `[${r.game}판 결과] AI(마피아)는 ${r.mafiaNick} / 모둠이 ${r.caught ? '찾아냄' : '못 찾음'} / 득표 ${r.tally.map((x) => `${x.nick}:${x.count}`).join(' ')} / 내 점수 변화 ${r.myDelta >= 0 ? '+' : ''}${r.myDelta}` +
        `\n  투표 근거: ${(r.votes || []).map((v) => `${v.fromNick || ''}→${v.targetNick || ''} "${v.reason || ''}"`).join(' / ')}` +
        `\n  점수: ${r.scores.map((x) => `${x.nick} ${x.score}`).join(', ')}${r.isLast ? '\n  (마지막 판이었음)' : ''}`
    );
  }
  return L.join('\n');
}

function needed(st, seen) {
  const g = st.group;
  const me = st.me;
  if (st.room.phase === 'CLOSING' || g.state === 'CLOSING') {
    const todo = [];
    if (me.postPoll === null || me.postPoll === undefined) todo.push(`poll post <번호> (질문 "${st.room.poll.question}" 0=${st.room.poll.options[0]}, 1=${st.room.poll.options[1]}, 2=${st.room.poll.options[2]})`);
    if (!me.pledge) todo.push(`pledge "<${st.room.pledgePrompt}>"`);
    return todo.length ? '정리 단계: ' + todo.join(' 그리고 ') : null;
  }
  if (g.state === 'LOBBY') {
    const todo = [];
    if (!me.greeting) todo.push(`greet "<${st.room.greetingPrompt}>"`);
    if (me.prePoll === null || me.prePoll === undefined) todo.push(`poll pre <번호> (질문 "${st.room.poll.question}" 0=${st.room.poll.options[0]}, 1=${st.room.poll.options[1]}, 2=${st.room.poll.options[2]})`);
    return todo.length ? '대기실: ' + todo.join(' 그리고 ') : null;
  }
  if (g.state === 'PLAYING' && g.turn && g.turn.playerId === me.id && me.role === 'human' && !g.turn.sending) {
    const key = `${g.game}-${g.round}-${g.turn.idx}`;
    if (seen.said !== key) return `지금 네 차례! say "<한 줄, ${st.room.maxLen}자 이내>" (남은 시간 ${Math.round(g.remainingMs / 1000)}초)`;
  }
  if (g.state === 'VOTING' && g.vote && !g.vote.done) return `투표! vote <별명> "<근거 5자 이상>" (자기 자신 제외)`;
  if (g.state === 'RESULT' && g.result && seen.result !== g.game) return '결과 확인(할 일 없음, 다시 wait)';
  return null;
}

async function sendCmd(c) {
  const id = Date.now() + '-' + Math.random().toString(36).slice(2, 6);
  const f = path.join(DIR, 'cmd', id + '.json');
  writeJSON(f, c);
  const out = f.replace(/\.json$/, '.result.json');
  for (let i = 0; i < 60; i++) {
    await sleep(250);
    const r = readJSON(out, null);
    if (r) return r;
  }
  return { ok: false, msg: '상주 프로세스가 응답하지 않아요' };
}

async function main() {
  if (cmd === 'daemon') return daemon();
  const seen = readJSON(F.seen, {});
  if (cmd === 'status' || cmd === 'wait') {
    const limit = Number(opt.timeout || 100) * 1000;
    const t0 = Date.now();
    for (;;) {
      const st = readJSON(F.state, null);
      if (st && st.error) return console.log('오류: ' + st.error);
      if (st && st.group) {
        const need = needed(st, seen);
        if (cmd === 'status' || need) {
          if (need && need.startsWith('결과')) writeJSON(F.seen, { ...seen, result: st.group.game });
          console.log(summary(st, seen) + `\n\n[할 일] ${need || '없음'}`);
          return;
        }
      }
      if (Date.now() - t0 > limit) {
        console.log((st && st.group ? summary(st, seen) : '(상태 없음)') + '\n\n[할 일] 아직 없음 — 다시 wait');
        return;
      }
      await sleep(500);
    }
  }
  const st = readJSON(F.state, null);
  let r;
  if (cmd === 'say') {
    r = await sendCmd({ type: 'say', text: rest.join(' ') });
    if (r.ok && st && st.group.turn) writeJSON(F.seen, { ...seen, said: `${st.group.game}-${st.group.round}-${st.group.turn.idx}` });
  } else if (cmd === 'greet') r = await sendCmd({ type: 'greet', text: rest.join(' ') });
  else if (cmd === 'vote') r = await sendCmd({ type: 'vote', target: rest[0], reason: rest.slice(1).join(' ') });
  else if (cmd === 'poll') r = await sendCmd({ type: 'poll', which: rest[0], choice: rest[1] });
  else if (cmd === 'pledge') r = await sendCmd({ type: 'pledge', text: rest.join(' ') });
  else return console.log('모르는 명령: ' + cmd);
  console.log(r.ok ? '성공' + (r.msg ? ' — ' + r.msg : '') : '실패 — ' + (r.msg || ''));
}

main();
