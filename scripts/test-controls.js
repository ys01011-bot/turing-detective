// 교사 조작 점검: 일시정지/재개, 턴 다시, 건너뛰기, 백업 강제, 투표 마감, 시간 초과 처리.
// 서버를 켠 상태에서: node scripts/test-controls.js
require('dotenv').config();
const { io } = require('socket.io-client');
const URL = `http://localhost:${process.env.PORT || 3000}`;
const PIN = process.env.TEACHER_PIN || '0000';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0;
const check = (name, ok, extra = '') => {
  if (!ok) fail++;
  console.log(`${ok ? '통과' : '실패'}  ${name} ${extra}`);
};

(async () => {
  const t = io(URL, { transports: ['websocket'] });
  let R = null;
  t.on('room-state', (r) => (R = r));
  await new Promise((r) => t.on('connect', r));
  await t.emitWithAck('teacher-auth', { pin: PIN });
  const { code } = await t.emitWithAck('create-room', { groupCount: 1, settings: { turnSec: 20, voteSec: 60, rounds: 1, games: 1, mafiaPick: 'app' } });
  // 학생 3명 (아무것도 보내지 않음)
  const kids = [];
  for (const nick of ['가람', '나래', '다온']) {
    const s = io(URL, { transports: ['websocket'], forceNew: true });
    await new Promise((r) => s.on('connect', r));
    const j = await s.emitWithAck('join', { code, nick, groupIdx: 0 });
    kids.push({ s, nick, id: j.playerId });
  }
  await sleep(300);
  await t.emitWithAck('start-game', { code, groupIdx: 'all' });
  for (const k of kids) k.s.emit('ack-role');
  await sleep(800);
  const g = () => R.groups[0];
  check('모두 확인하면 바로 대화 시작', g().state === 'PLAYING');

  // 일시정지: 남은 시간이 줄지 않아야 함
  await t.emitWithAck('pause', { code, groupIdx: 0, paused: true });
  await sleep(400);
  const r1 = g().remainingMs;
  await sleep(1500);
  check('일시정지 중 시간 멈춤', g().paused && g().remainingMs === r1, `(${r1}ms)`);
  await t.emitWithAck('pause', { code, groupIdx: 0, paused: false });
  await sleep(1300);
  check('다시 시작하면 시간 흐름', !g().paused && g().remainingMs < r1);

  // 건너뛰기
  const before = g().turn.idx;
  await t.emitWithAck('skip-turn', { code, groupIdx: 0 });
  await sleep(400);
  check('턴 건너뛰기 → (패스) 게시', g().messages.at(-1).pass && g().turn.idx === before + 1);

  // 마피아 차례까지 건너뛰고 백업 강제
  for (let i = 0; i < 3 && !g().turn.isMafia; i++) {
    await t.emitWithAck('skip-turn', { code, groupIdx: 0 });
    await sleep(300);
  }
  if (g().state === 'PLAYING' && g().turn.isMafia) {
    const fb = await t.emitWithAck('force-backup', { code, groupIdx: 0 });
    await sleep(400);
    check('백업 메시지 강제', fb.ok && g().turn.aiSource === 'backup' && !!g().turn.aiText, `"${g().turn.aiText}"`);
    const rd = await t.emitWithAck('redo-turn', { code, groupIdx: 0 });
    await sleep(300);
    check('턴 다시 하기', rd.ok && g().turn.isMafia && g().turn.ghostPos === 0);
    // 마피아가 키를 한 번 누르고 시간 초과 → AI 문장 전체 게시
    const mafia = kids.find((k) => k.id === g().turn.playerId);
    mafia.s.emit('typing', { pos: 1 });
    console.log('     (턴 시간 초과를 기다리는 중 약 24초)');
    await sleep(24000); // 마감 20초 + 게시 지연 2초 + 여유
    const last = g().messages.at(-1);
    check('마피아 시간 초과(키 누름) → AI 문장 전체 게시', last && last.isAI && !last.pass, `"${last && last.text}"`);
  } else {
    check('마피아 차례 찾기', false, '(이번 판은 순서상 못 찾음)');
  }

  // 남은 사람 차례 건너뛰고 투표로
  for (let i = 0; i < 5 && g().state === 'PLAYING'; i++) {
    await t.emitWithAck('skip-turn', { code, groupIdx: 0 });
    await sleep(300);
  }
  check('바퀴 끝 → 투표', g().state === 'VOTING');
  const v = await kids[0].s.emitWithAck('vote', { targetId: kids[0].id, reason: '나를 고르기' });
  check('자기 자신 투표 막기', !v.ok);
  const v2 = await kids[0].s.emitWithAck('vote', { targetId: kids[1].id, reason: '짧' });
  check('근거 5자 미만 막기', !v2.ok);
  await kids[0].s.emitWithAck('vote', { targetId: kids[1].id, reason: '경험이 막연했어' });
  await t.emitWithAck('end-vote', { code, groupIdx: 0 });
  await sleep(400);
  check('투표 마감 → 결과 (나머지는 기권)', g().state === 'RESULT' && g().results[0].votes.filter((x) => x.abstain).length === 2);

  await t.emitWithAck('close-room', { code });
  console.log(fail ? `실패 ${fail}건` : '모두 통과');
  process.exit(fail ? 1 : 0);
})();
