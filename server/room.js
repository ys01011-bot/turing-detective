// 방·모둠·플레이어 상태와, 학생·교사에게 보낼 상태 만들기.
// 원칙: 학생에게 보내는 state 에는 다른 사람의 역할과 AI 원문을 절대 넣지 않는다.
const crypto = require('crypto');
const content = require('./content');

const rooms = new Map(); // code → Room
const ROOM_TTL_MS = 3 * 60 * 60 * 1000;

const DEFAULT_SETTINGS = {
  groupSize: 6, // 권장 인원 3~7 (표시용, 시작은 3명 이상이면 가능)
  games: 2, // 1~3
  rounds: 2, // 1~3
  turnSec: 30, // 20~60
  voteSec: 90, // 60~180
  maxLen: 80, // 40~150
  levels: ['Lv2', 'Lv3', 'Lv3'],
  questionChance: false, // 12장 선택 기능 — 자리만
  spellAI: true, // 맞춤법 AI 보정
  postDelayMs: 1200, // 7.4 지연 통일
  roleRevealSec: 20,
  aiCallLimit: 300,
  absentPassSec: 30, // 30초 넘게 미접속이면 턴 자동 패스
};

const clamp = (v, lo, hi, d) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : d;
};

function sanitizeSettings(s = {}) {
  const d = DEFAULT_SETTINGS;
  const lv = (x, def) => (['Lv1', 'Lv2', 'Lv3'].includes(x) ? x : def);
  const levels = Array.isArray(s.levels) ? s.levels : d.levels;
  return {
    ...d,
    groupSize: clamp(s.groupSize, 3, 7, d.groupSize),
    games: clamp(s.games, 1, 3, d.games),
    rounds: clamp(s.rounds, 1, 3, d.rounds),
    turnSec: clamp(s.turnSec, 20, 60, d.turnSec),
    voteSec: clamp(s.voteSec, 60, 180, d.voteSec),
    maxLen: clamp(s.maxLen, 40, 150, d.maxLen),
    levels: [lv(levels[0], 'Lv2'), lv(levels[1], 'Lv3'), lv(levels[2], 'Lv3')],
    questionChance: !!s.questionChance,
    spellAI: s.spellAI === undefined ? d.spellAI : !!s.spellAI,
  };
}

function newCode() {
  let code;
  do code = String(Math.floor(100000 + Math.random() * 900000));
  while (rooms.has(code));
  return code;
}

function createRoom({ groupCount = 3, settings = {}, gameCfg = [] } = {}) {
  const code = newCode();
  const S = sanitizeSettings(settings);
  const defaults = content.topicSets().defaults || {};
  const cfg = [];
  for (let g = 0; g < 3; g++) {
    const c = gameCfg[g] || {};
    cfg.push({
      setId: c.setId || defaults['game' + (g + 1)] || content.topicSets().sets[0].id,
      custom: Array.isArray(c.custom) ? c.custom.map((x) => ({ question: String(x.question || '').slice(0, 80), clue: x.clue })) : null,
    });
  }
  const room = {
    code,
    createdAt: Date.now(),
    expiresAt: Date.now() + ROOM_TTL_MS,
    settings: S,
    gameCfg: cfg,
    phase: 'ACTIVE', // ACTIVE | CLOSING
    players: new Map(),
    groups: [],
    evidence: [], // {id, game, groupIdx, voterId, voterNick, targetNick, targetWasMafia, reason, label, best}
    alerts: [], // {id, ts, groupIdx, text}
    usedBackups: new Set(),
    aiCalls: 0,
    seq: 0,
  };
  const n = clamp(groupCount, 1, 4, 3);
  for (let i = 0; i < n; i++) room.groups.push(newGroup(i));
  rooms.set(code, room);
  return room;
}

function newGroup(idx) {
  return {
    idx,
    playerIds: [], // 자리(입장) 순서
    state: 'LOBBY', // LOBBY | ROLE_REVEAL | PLAYING | VOTING | RESULT | CLOSING
    game: 0,
    round: 0,
    turnIdx: 0,
    order: [], // 이번 판 발언 순서 (playerId)
    mafiaId: null,
    pastMafia: new Set(),
    acks: new Set(),
    turn: null, // {id, playerId, startedAt, deadline, draft, aiText, aiSource, aiLatency, ghostPos, keyPressed, sending}
    messages: [], // {id, game, round, playerId, nick, text, isAI, pass, ts, source}
    votes: new Map(), // voterId → {targetId, reason}
    results: [], // game-1 → result
    paused: false,
    timer: null,
    timerFn: null,
    deadline: null,
    pausedRemaining: null,
  };
}

function getRoom(code) {
  const r = rooms.get(String(code || '').trim());
  if (r && r.expiresAt < Date.now()) {
    deleteRoom(r.code);
    return null;
  }
  return r || null;
}

function deleteRoom(code) {
  const r = rooms.get(code);
  if (!r) return;
  for (const g of r.groups) clearTimeout(g.timer);
  rooms.delete(code);
}

function newId(prefix = 'p') {
  return prefix + crypto.randomBytes(6).toString('hex');
}

function addPlayer(room, { nick, groupIdx }) {
  const g = room.groups[groupIdx];
  const p = {
    id: newId('p'),
    nick,
    groupIdx,
    greeting: '',
    connected: true,
    sockets: 0,
    lastSeen: Date.now(),
    disconnectedAt: null,
    score: 0,
    prePoll: null,
    postPoll: null,
    pledge: '',
  };
  room.players.set(p.id, p);
  g.playerIds.push(p.id);
  return p;
}

function removePlayer(room, playerId) {
  const p = room.players.get(playerId);
  if (!p) return;
  const g = room.groups[p.groupIdx];
  g.playerIds = g.playerIds.filter((id) => id !== playerId);
  room.players.delete(playerId);
}

function movePlayer(room, playerId, toIdx) {
  const p = room.players.get(playerId);
  const to = room.groups[toIdx];
  if (!p || !to) return false;
  const from = room.groups[p.groupIdx];
  from.playerIds = from.playerIds.filter((id) => id !== playerId);
  to.playerIds.push(playerId);
  p.groupIdx = toIdx;
  return true;
}

function roundInfo(room, group) {
  if (!group.game) return null;
  return content.getRound(room.gameCfg[group.game - 1], Math.max(1, group.round || 1));
}

const remainingMs = (g) => (g.paused ? g.pausedRemaining : g.deadline ? Math.max(0, g.deadline - Date.now()) : null);

/** 학생 한 명에게 보낼 상태 (그 학생이 알아야 할 것만) */
function studentState(room, p) {
  const g = room.groups[p.groupIdx];
  const Q = content.classQuestions();
  const ri = roundInfo(room, g);
  const nickOf = (id) => room.players.get(id)?.nick || '(나간 친구)';
  const isMafia = g.mafiaId === p.id;
  const showRole = g.state !== 'LOBBY' && g.game > 0;
  const curGameMsgs = g.messages.filter((m) => m.game === g.game);
  const result = g.state === 'RESULT' ? g.results[g.game - 1] : null;
  const st = {
    now: Date.now(),
    room: {
      code: room.code,
      phase: room.phase,
      maxLen: room.settings.maxLen,
      turnSec: room.settings.turnSec,
      voteSec: room.settings.voteSec,
      games: room.settings.games,
      rounds: room.settings.rounds,
      notice: Q.notice,
      poll: Q.poll,
      greetingPrompt: Q.greetingPrompt,
      pledgePrompt: Q.pledgePrompt,
      pledgeExample: Q.pledgeExample,
    },
    me: {
      id: p.id,
      nick: p.nick,
      groupIdx: p.groupIdx,
      greeting: p.greeting,
      score: p.score,
      prePoll: p.prePoll,
      postPoll: p.postPoll,
      pledge: p.pledge,
      role: showRole ? (isMafia ? 'mafia' : 'human') : null,
      roleText: showRole ? Q.roleText[isMafia ? 'mafia' : 'human'] : null,
      acked: g.acks.has(p.id),
    },
    group: {
      idx: g.idx,
      state: g.state,
      game: g.game,
      round: g.round,
      paused: g.paused,
      question: ri ? ri.question : null,
      remainingMs: remainingMs(g),
      members: g.playerIds.map((id) => {
        const m = room.players.get(id);
        return { id, nick: m.nick, connected: m.connected, greeted: !!m.greeting };
      }),
      greetings: g.playerIds
        .map((id) => room.players.get(id))
        .filter((m) => m.greeting)
        .map((m) => ({ id: m.id, nick: m.nick, text: m.greeting })),
      messages: curGameMsgs.map((m) => ({ id: m.id, round: m.round, playerId: m.playerId, nick: m.nick, text: m.text, pass: m.pass })),
      turn: g.turn && g.state === 'PLAYING' ? { playerId: g.turn.playerId, nick: nickOf(g.turn.playerId), sending: g.turn.sending, idx: g.turnIdx, of: g.order.length } : null,
      vote:
        g.state === 'VOTING'
          ? { done: g.votes.has(p.id), count: g.votes.size, total: g.playerIds.length, my: g.votes.get(p.id) || null }
          : null,
      result: result ? studentResult(room, g, result, p) : null,
    },
  };
  // 마피아 본인에게만, 자기 차례일 때만 고스트 문장
  if (isMafia && g.state === 'PLAYING' && g.turn && g.turn.playerId === p.id) {
    st.ghost = { turnId: g.turn.id, text: g.turn.aiText, pos: g.turn.ghostPos };
  }
  // 재접속 시 사람의 입력 중 글 복구
  if (!isMafia && g.state === 'PLAYING' && g.turn && g.turn.playerId === p.id) st.draft = g.turn.draft;
  return st;
}

function studentResult(room, g, r, p) {
  return {
    game: r.game,
    mafiaId: r.mafiaId,
    mafiaNick: r.mafiaNick,
    caught: r.caught,
    aiMessageIds: r.aiMessageIds,
    tally: r.tally,
    votes: r.votes,
    lookalike: r.lookalike,
    myDelta: r.deltas[p.id] || 0,
    scores: g.playerIds.map((id) => ({ id, nick: room.players.get(id).nick, score: room.players.get(id).score })).sort((a, b) => b.score - a.score),
    isLast: g.game >= room.settings.games,
  };
}

/** 교사 화면 전체 상태 (마피아 포함) */
function teacherState(room) {
  const Q = content.classQuestions();
  const sets = content.topicSets().sets.map((s) => ({ id: s.id, title: s.title, rounds: s.rounds.map((r) => ({ question: r.question, clue: r.clue })) }));
  const players = [...room.players.values()];
  const pollCount = (key) => {
    const c = Q.poll.options.map(() => 0);
    for (const p of players) if (p[key] !== null && p[key] !== undefined) c[p[key]]++;
    return c;
  };
  return {
    now: Date.now(),
    code: room.code,
    phase: room.phase,
    settings: room.settings,
    gameCfg: room.gameCfg,
    sets,
    aiCalls: room.aiCalls,
    expiresAt: room.expiresAt,
    poll: { question: Q.poll.question, options: Q.poll.options, pre: pollCount('prePoll'), post: pollCount('postPoll') },
    closingSteps: Q.closingSteps,
    pledges: players.filter((p) => p.pledge).map((p) => ({ nick: p.nick, groupIdx: p.groupIdx, text: p.pledge })),
    evidence: room.evidence,
    alerts: room.alerts.slice(-30),
    groups: room.groups.map((g) => {
      const ri = roundInfo(room, g);
      return {
        idx: g.idx,
        state: g.state,
        game: g.game,
        round: g.round,
        paused: g.paused,
        question: ri ? ri.question : null,
        remainingMs: remainingMs(g),
        mafiaId: g.mafiaId,
        mafiaNick: g.mafiaId ? room.players.get(g.mafiaId)?.nick : null,
        acks: g.acks.size,
        members: g.playerIds.map((id) => {
          const m = room.players.get(id);
          return { id, nick: m.nick, connected: m.connected, greeting: m.greeting, score: m.score, voted: g.votes.has(id), wasMafia: g.pastMafia.has(id) };
        }),
        turn: g.turn
          ? {
              playerId: g.turn.playerId,
              nick: room.players.get(g.turn.playerId)?.nick,
              idx: g.turnIdx,
              of: g.order.length,
              isMafia: g.turn.playerId === g.mafiaId,
              aiReady: !!g.turn.aiText,
              aiText: g.turn.aiText,
              aiSource: g.turn.aiSource,
              aiLatency: g.turn.aiLatency,
              ghostPos: g.turn.ghostPos,
              sending: g.turn.sending,
            }
          : null,
        messages: g.messages.map((m) => ({ id: m.id, game: m.game, round: m.round, nick: m.nick, text: m.text, isAI: m.isAI, pass: m.pass, source: m.source, original: m.original })),
        votes: g.state === 'VOTING' ? g.votes.size : null,
        results: g.results,
      };
    }),
  };
}

// 만료된 방 정리
setInterval(() => {
  const now = Date.now();
  for (const [code, r] of rooms) if (r.expiresAt < now) deleteRoom(code);
}, 60 * 1000).unref();

module.exports = {
  rooms,
  createRoom,
  getRoom,
  deleteRoom,
  addPlayer,
  removePlayer,
  movePlayer,
  newId,
  studentState,
  teacherState,
  roundInfo,
  sanitizeSettings,
  DEFAULT_SETTINGS,
};
