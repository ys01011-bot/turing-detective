// 3장 놀이 규칙: 역할 배정, 턴, 타이머, 고스트 타이핑, 투표, 점수.
// 모든 판정은 서버가 한다.
const { newId, roundInfo } = require('./room');
const { processMessage } = require('./pipeline');
const { generateMafiaMessage } = require('./mafia');
const { classifyRoom } = require('./classify');
const content = require('./content');

let hub = {
  emitGroup() {},
  emitTeacher() {},
  typing() {},
  toPlayer() {},
  groupMoved() {},
};
function setHub(h) {
  hub = h;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const len = (s) => [...(s || '')].length;

// ── 타이머 (일시정지 지원) ─────────────────────────────
function setTimer(g, ms, fn) {
  clearTimeout(g.timer);
  g.timer = null;
  g.timerFn = fn;
  if (g.paused) {
    g.pausedRemaining = ms;
    g.deadline = null;
    return;
  }
  g.deadline = Date.now() + ms;
  g.timer = setTimeout(() => {
    g.timer = null;
    g.deadline = null;
    g.timerFn = null;
    fn();
  }, ms);
}
function clearTimer(g) {
  clearTimeout(g.timer);
  g.timer = null;
  g.timerFn = null;
  g.deadline = null;
  g.pausedRemaining = null;
}

function update(room, g) {
  hub.emitGroup(room, g);
  hub.emitTeacher(room);
}

function addAlert(room, groupIdx, text) {
  const a = { id: newId('a'), ts: Date.now(), groupIdx, text };
  room.alerts.push(a);
  hub.emitTeacher(room);
  return a;
}

// ── 입장 인사·사전/사후 질문·약속 ───────────────────────
async function setGreeting(room, p, text) {
  const g = room.groups[p.groupIdx];
  if (g.state !== 'LOBBY') return { ok: false, msg: '게임이 시작되어 인사를 바꿀 수 없어요.' };
  const r = await processMessage(room, text);
  if (!r.ok) {
    if (r.reason === 'banned') addAlert(room, g.idx, `금칙어(입장 인사): ${p.nick} — "${r.original}"`);
    return { ok: false, msg: r.reason === 'banned' ? '다시 써 주세요. 친구가 들으면 속상한 말이 있어요.' : '인사를 한 줄 써 주세요.' };
  }
  p.greeting = r.text;
  update(room, g);
  return { ok: true };
}

// ── 판 시작 · 역할 배정 ─────────────────────────────
function startGame(room, g) {
  if (room.phase !== 'ACTIVE') return { ok: false, msg: '정리 단계에서는 시작할 수 없어요.' };
  if (!['LOBBY', 'RESULT'].includes(g.state)) return { ok: false, msg: `${g.idx + 1}모둠은 지금 진행 중이에요.` };
  if (g.game >= room.settings.games) return { ok: false, msg: `${g.idx + 1}모둠은 모든 판을 마쳤어요.` };
  if (g.playerIds.length < 3) return { ok: false, msg: `${g.idx + 1}모둠 인원이 3명보다 적어요.` };
  g.game += 1;
  // 이번 수업에서 이미 마피아였던 사람 제외
  let pool = g.playerIds.filter((id) => !g.pastMafia.has(id));
  if (!pool.length) pool = [...g.playerIds];
  g.mafiaId = pool[Math.floor(Math.random() * pool.length)];
  g.pastMafia.add(g.mafiaId);
  g.mafiaGames = (g.mafiaGames || []).concat(g.mafiaId);
  // 이번 판 AI의 의도적 허점(지도서의 AI 한계). 교사 화면에만 보인다.
  g.pastFlaws = g.pastFlaws || [];
  try {
    const level = room.settings.levels[g.game - 1] || 'Lv2';
    g.flaw = content.planFlaw(room.gameCfg[g.game - 1], level, room.settings.rounds, g.pastFlaws);
    g.pastFlaws.push(g.flaw.id);
  } catch (e) {
    console.error('[허점] 정하지 못했어요:', e.message);
    g.flaw = null;
  }
  g.acks = new Set();
  g.votes = new Map();
  g.round = 0;
  g.turn = null;
  g.state = 'ROLE_REVEAL';
  // 터치 지정: 모두 엎드린 동안 교사가 터치하고 '고개 들기'를 누를 때까지 기다린다(타이머 없음)
  if (room.settings.mafiaPick !== 'touch') setTimer(g, room.settings.roleRevealSec * 1000, () => startPlaying(room, g));
  update(room, g);
  return { ok: true };
}

/** 터치 지정: 교사가 터치할 학생을 바꾼다(엎드린 동안만) */
function setMafia(room, g, playerId) {
  if (g.state !== 'ROLE_REVEAL') return { ok: false, msg: '엎드려 있는 동안에만 바꿀 수 있어요.' };
  if (!g.playerIds.includes(playerId)) return { ok: false, msg: '이 모둠 학생이 아니에요.' };
  if (playerId === g.mafiaId) return { ok: true };
  if (!(g.mafiaGames || []).slice(0, -1).includes(g.mafiaId)) g.pastMafia.delete(g.mafiaId);
  g.mafiaId = playerId;
  g.pastMafia.add(playerId);
  if (g.mafiaGames) g.mafiaGames[g.mafiaGames.length - 1] = playerId;
  update(room, g);
  return { ok: true };
}

/** 터치 지정: '고개 들기' → 대화 시작 */
function beginChat(room, g) {
  if (g.state !== 'ROLE_REVEAL') return { ok: false, msg: `${g.idx + 1}모둠은 엎드리기 단계가 아니에요.` };
  startPlaying(room, g);
  return { ok: true };
}

function ackRole(room, g, p) {
  if (g.state !== 'ROLE_REVEAL') return;
  if (room.settings.mafiaPick === 'touch') return; // 터치 지정에서는 교사의 '고개 들기'로만 시작
  g.acks.add(p.id);
  const everyone = g.playerIds.filter((id) => room.players.get(id)?.connected).every((id) => g.acks.has(id));
  if (everyone) startPlaying(room, g);
  else update(room, g);
}

function startPlaying(room, g) {
  if (g.state !== 'ROLE_REVEAL') return;
  clearTimer(g);
  const n = g.playerIds.length;
  const shift = (g.game - 1) % n; // 판마다 시작하는 사람을 한 칸씩
  g.order = g.playerIds.slice(shift).concat(g.playerIds.slice(0, shift));
  g.state = 'PLAYING';
  g.round = 1;
  g.turnIdx = 0;
  startTurn(room, g);
}

// ── 턴 ─────────────────────────────────────────
function startTurn(room, g) {
  // 순서에 있던 사람이 나갔으면(강제 퇴장) 건너뛴다
  while (g.turnIdx < g.order.length && !room.players.has(g.order[g.turnIdx])) g.turnIdx++;
  if (g.turnIdx >= g.order.length) return endRound(room, g);
  const playerId = g.order[g.turnIdx];
  const p = room.players.get(playerId);
  const turn = {
    id: newId('t'),
    playerId,
    startedAt: Date.now(),
    draft: '',
    aiText: null,
    aiSource: null,
    aiLatency: null,
    ghostPos: 0,
    keyPressed: false,
    sending: false,
  };
  g.turn = turn;
  setTimer(g, room.settings.turnSec * 1000, () => turnTimeout(room, g, turn.id));
  if (playerId === g.mafiaId) requestAI(room, g, turn);
  // 30초 넘게 미접속이면 자동 패스
  if (!p.connected && p.disconnectedAt && Date.now() - p.disconnectedAt > room.settings.absentPassSec * 1000) {
    setTimeout(() => {
      if (g.turn === turn && !turn.sending) publish(room, g, turn, { pass: true });
    }, 1500);
  }
  update(room, g);
}

async function requestAI(room, g, turn, opts = {}) {
  const mafia = room.players.get(g.mafiaId);
  const r = await generateMafiaMessage(room, g, mafia, opts);
  console.log(`[마피아] ${g.idx + 1}모둠 ${r.source}${r.note ? "(" + r.note + ")" : ""} ${r.latencyMs}ms: ${r.text}`);
  if (g.turn !== turn || turn.sending) return;
  turn.aiText = r.text;
  turn.aiSource = r.source;
  turn.aiFlaw = r.flaw || null;
  turn.aiLatency = r.latencyMs;
  turn.minSendAt = paceTarget(room, g, turn, r.text);
  turn.ghostPos = Math.min(turn.ghostPos, len(r.text));
  if (r.alert) addAlert(room, g.idx, r.alert);
  update(room, g);
}

/** 키 입력 신호. 사람: draft 저장 / 마피아: 고스트 진행 위치 저장. '입력 중…'은 둘 다 똑같이 보낸다. */
function onTyping(room, g, p, data = {}) {
  const t = g.turn;
  if (g.state !== 'PLAYING' || !t || t.playerId !== p.id || t.sending) return;
  if (p.id === g.mafiaId) {
    t.keyPressed = true;
    if (t.aiText && Number.isFinite(data.pos)) t.ghostPos = Math.max(t.ghostPos, Math.min(len(t.aiText), Math.floor(data.pos)));
  } else if (typeof data.draft === 'string') {
    t.draft = data.draft.slice(0, room.settings.maxLen + 20);
  }
  hub.typing(room, g, p.id);
}

async function send(room, g, p, text) {
  const t = g.turn;
  if (g.state !== 'PLAYING' || !t || t.playerId !== p.id || t.sending) return { ok: false };
  const sentAt = Date.now();
  if (p.id === g.mafiaId) {
    if (!t.aiText || t.ghostPos < len(t.aiText)) return { ok: false, msg: '아직 다 쓰지 않았어요.' };
    t.sending = true;
    update(room, g);
    // 모둠 친구들의 실제 반응 속도보다 빨리 올라오지 않게 기다린다(그동안 '입력 중…' 유지)
    await holdUntil(room, g, t, t.minSendAt);
    await delayFrom(room, g, Date.now());
    return publish(room, g, t, { text: t.aiText, isAI: true, source: t.aiSource, flaw: t.aiFlaw });
  }
  t.sending = true;
  update(room, g);
  const r = await processMessage(room, text);
  if (!r.ok) {
    t.sending = false;
    if (r.reason === 'banned') {
      addAlert(room, g.idx, `금칙어: ${p.nick} — "${r.original}"`);
      update(room, g);
      return { ok: false, msg: '다시 써 주세요. 친구가 들으면 속상한 말이 있어요.' };
    }
    update(room, g);
    return { ok: false, msg: '한 글자 이상 써 주세요.' };
  }
  t.sentAt = sentAt;
  await delayFrom(room, g, sentAt);
  return publish(room, g, t, { text: r.text, original: r.original !== r.text ? r.original : undefined });
}

// 7.4 지연 통일: '전송' 순간부터 고정 시간 뒤 게시. 그동안 '입력 중…' 유지
async function delayFrom(room, g, sentAt) {
  const until = sentAt + room.settings.postDelayMs;
  while (Date.now() < until) {
    if (g.turn) hub.typing(room, g, g.turn.playerId);
    await sleep(Math.min(500, until - Date.now()));
  }
}

// 7.6 AI 응답 속도 맞추기: 이 모둠 사람들의 실제 반응 시간(차례 시작 → 전송)을 실시간으로 모아
// AI 메시지가 그보다 빨리 올라오지 않게 '가장 이른 전송 시각'을 정한다.
const median = (a) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? s[Math.floor((s.length - 1) / 2)] : 0;
};
function paceTarget(room, g, turn, text) {
  const n = Math.max(5, len(text));
  const P = (g.pace || []).slice(-12);
  let target;
  if (P.length >= 2) {
    const perChar = median(P.map((x) => x.ms / Math.max(5, x.chars)));
    target = 0.5 * perChar * n + 0.5 * median(P.map((x) => x.ms)); // 길이 비례와 모둠 평소 속도를 반반
  } else {
    target = 4000 + 450 * n; // 아직 표본이 없으면 초등학생 타자 기준 기본값
  }
  target *= 0.85 + Math.random() * 0.35; // 매번 똑같지 않게
  const maxMs = room.settings.turnSec * 1000 - room.settings.postDelayMs - 1500;
  target = Math.max(3000, Math.min(target, maxMs));
  console.log(`[속도] ${g.idx + 1}모둠 AI 목표 ${(target / 1000).toFixed(1)}초 (사람 표본 ${P.length}개${P.length ? ', 중앙값 ' + (median(P.map((x) => x.ms)) / 1000).toFixed(1) + '초' : ''})`);
  return turn.startedAt + target;
}
async function holdUntil(room, g, turn, until) {
  while (until && Date.now() < until && g.turn === turn) {
    hub.typing(room, g, turn.playerId);
    await sleep(Math.min(500, until - Date.now()));
  }
}

function publish(room, g, turn, { text, isAI = false, pass = false, source, original, flaw = null }) {
  if (g.turn !== turn) return { ok: false };
  const p = room.players.get(turn.playerId);
  g.messages.push({
    id: newId('m'),
    game: g.game,
    round: g.round,
    playerId: turn.playerId,
    nick: p ? p.nick : '(나간 친구)',
    text: pass ? '(패스)' : text,
    isAI: turn.playerId === g.mafiaId && !pass ? true : isAI,
    pass,
    source,
    original,
    flaw: pass ? null : flaw,
    ts: Date.now(),
  });
  if (!pass && !isAI && turn.playerId !== g.mafiaId && turn.sentAt) {
    g.pace = (g.pace || []).concat({ ms: turn.sentAt - turn.startedAt, chars: len(text) }).slice(-12);
  }
  g.turn = null;
  g.turnIdx += 1;
  if (g.turnIdx >= g.order.length) endRound(room, g);
  else startTurn(room, g);
  return { ok: true };
}

function endRound(room, g) {
  if (g.round >= room.settings.rounds) return startVoting(room, g);
  g.round += 1;
  g.turnIdx = 0;
  startTurn(room, g);
}

async function turnTimeout(room, g, turnId) {
  const t = g.turn;
  if (!t || t.id !== turnId || t.sending) return;
  const p = room.players.get(t.playerId);
  const sentAt = Date.now();
  t.sending = true;
  update(room, g);
  if (t.playerId === g.mafiaId) {
    if (!t.keyPressed) return publish(room, g, t, { pass: true });
    if (!t.aiText) {
      // 키는 눌렀는데 AI 문장이 아직 → 백업으로 바로
      const r = await generateMafiaMessage(room, g, p, { forceBackup: true });
      t.aiText = r.text;
      t.aiSource = 'backup';
      t.aiFlaw = null;
      t.minSendAt = 0; // 시간 초과 전송은 이미 마감 시각
    }
    await delayFrom(room, g, sentAt);
    return publish(room, g, t, { text: t.aiText, isAI: true, source: t.aiSource, flaw: t.aiFlaw });
  }
  const draft = (t.draft || '').trim();
  if (!draft) return publish(room, g, t, { pass: true });
  const r = await processMessage(room, draft);
  if (!r.ok) {
    if (r.reason === 'banned') addAlert(room, g.idx, `금칙어(시간 초과 전송): ${p?.nick} — "${r.original}"`);
    return publish(room, g, t, { pass: true });
  }
  t.sentAt = sentAt;
  await delayFrom(room, g, sentAt);
  return publish(room, g, t, { text: r.text, original: r.original !== r.text ? r.original : undefined });
}

// ── 교사 조작 ─────────────────────────────────────
function setPaused(room, g, paused) {
  if (paused === g.paused) return;
  if (paused) {
    if (g.timer) {
      g.pausedRemaining = Math.max(0, g.deadline - Date.now());
      clearTimeout(g.timer);
      g.timer = null;
      g.deadline = null;
    }
    g.paused = true;
  } else {
    g.paused = false;
    if (g.timerFn) setTimer(g, g.pausedRemaining ?? 5000, g.timerFn);
    g.pausedRemaining = null;
  }
  update(room, g);
}

function redoTurn(room, g) {
  if (g.state !== 'PLAYING' || !g.turn || g.turn.sending) return { ok: false, msg: '지금은 다시 할 수 없어요.' };
  startTurn(room, g);
  return { ok: true };
}

function skipTurn(room, g) {
  if (g.state !== 'PLAYING' || !g.turn || g.turn.sending) return { ok: false, msg: '지금은 건너뛸 수 없어요.' };
  publish(room, g, g.turn, { pass: true });
  return { ok: true };
}

async function forceBackup(room, g) {
  const t = g.turn;
  if (g.state !== 'PLAYING' || !t || t.playerId !== g.mafiaId || t.sending) return { ok: false, msg: '지금은 마피아 차례가 아니에요.' };
  const r = await generateMafiaMessage(room, g, room.players.get(g.mafiaId), { forceBackup: true });
  if (g.turn !== t || t.sending) return { ok: false };
  t.aiText = r.text;
  t.aiSource = 'backup';
  t.aiFlaw = null;
  t.minSendAt = paceTarget(room, g, t, r.text);
  t.aiLatency = r.latencyMs;
  t.ghostPos = 0;
  update(room, g);
  return { ok: true };
}

// ── 투표 ─────────────────────────────────────────
function startVoting(room, g) {
  g.state = 'VOTING';
  g.turn = null;
  g.votes = new Map();
  setTimer(g, room.settings.voteSec * 1000, () => finishVoting(room, g));
  update(room, g);
}

function vote(room, g, p, targetId, reason) {
  if (g.state !== 'VOTING') return { ok: false, msg: '지금은 투표 시간이 아니에요.' };
  if (g.votes.has(p.id)) return { ok: false, msg: '이미 투표했어요.' };
  if (targetId === p.id || !g.playerIds.includes(targetId)) return { ok: false, msg: '나를 뺀 친구 한 명을 골라 주세요.' };
  const why = String(reason || '').replace(/\s+/g, ' ').trim().slice(0, 200);
  if (len(why) < 5) return { ok: false, msg: '근거를 5자 이상 써 주세요.' };
  g.votes.set(p.id, { targetId, reason: why });
  if (g.playerIds.every((id) => g.votes.has(id))) finishVoting(room, g);
  else update(room, g);
  return { ok: true };
}

function finishVoting(room, g) {
  if (g.state !== 'VOTING') return;
  clearTimer(g);
  const nick = (id) => room.players.get(id)?.nick || '(나간 친구)';
  const count = new Map(g.playerIds.map((id) => [id, 0]));
  for (const [, v] of g.votes) count.set(v.targetId, (count.get(v.targetId) || 0) + 1);
  const max = Math.max(0, ...count.values());
  const tops = [...count].filter(([, c]) => c === max && max > 0).map(([id]) => id);
  const soleTop = tops.length === 1 ? tops[0] : null;
  const caught = soleTop === g.mafiaId;
  const deltas = {};
  for (const id of g.playerIds) {
    let d = 0;
    if (id === g.mafiaId) d = Math.max(0, 5 - (count.get(id) || 0));
    else {
      const v = g.votes.get(id);
      if (v && v.targetId === g.mafiaId) d += 2;
      if (caught) d += 1;
    }
    deltas[id] = d;
    const p = room.players.get(id);
    if (p) p.score += d;
  }
  const result = {
    game: g.game,
    mafiaId: g.mafiaId,
    mafiaNick: nick(g.mafiaId),
    caught,
    aiMessageIds: g.messages.filter((m) => m.game === g.game && m.isAI).map((m) => m.id),
    tally: [...count].map(([id, c]) => ({ id, nick: nick(id), count: c })).sort((a, b) => b.count - a.count),
    votes: g.playerIds.map((id) => {
      const v = g.votes.get(id);
      return v
        ? { voterId: id, voterNick: nick(id), targetId: v.targetId, targetNick: nick(v.targetId), reason: v.reason }
        : { voterId: id, voterNick: nick(id), abstain: true };
    }),
    lookalike: soleTop && soleTop !== g.mafiaId ? nick(soleTop) : null,
    deltas,
  };
  g.results[g.game - 1] = result;
  // 근거 보드용 (마피아의 위장 투표는 제외)
  for (const [voterId, v] of g.votes) {
    if (voterId === g.mafiaId) continue;
    room.evidence.push({
      id: newId('r'),
      game: g.game,
      groupIdx: g.idx,
      voterNick: nick(voterId),
      targetNick: nick(v.targetId),
      targetWasMafia: v.targetId === g.mafiaId,
      reason: v.reason,
      label: null,
      best: false,
    });
  }
  g.state = 'RESULT';
  update(room, g);
  // 진행 중인 모둠이 없으면 방 전체 근거를 한 번에 분류
  const busy = room.groups.some((x) => ['ROLE_REVEAL', 'PLAYING', 'VOTING'].includes(x.state));
  if (!busy) classifyRoom(room).then(() => hub.emitTeacher(room));
}

// ── 정리 단계 ─────────────────────────────────────
function startClosing(room) {
  room.phase = 'CLOSING';
  for (const g of room.groups) {
    clearTimer(g);
    g.turn = null;
    g.paused = false;
    g.state = 'CLOSING';
    hub.emitGroup(room, g);
  }
  classifyRoom(room).then(() => hub.emitTeacher(room));
  hub.emitTeacher(room);
}

module.exports = {
  setHub,
  setGreeting,
  startGame,
  setMafia,
  beginChat,
  ackRole,
  onTyping,
  send,
  vote,
  setPaused,
  redoTurn,
  skipTurn,
  forceBackup,
  finishVoting,
  startClosing,
  addAlert,
  roundInfo,
};
