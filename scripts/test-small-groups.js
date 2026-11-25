// 인원이 적은 모둠 점검: 4명 · 3명 · 0명 모둠에서 '전체 시작'이 되는지, 2명 모둠은 안내만 하는지.
// 서버를 켠 상태에서: node scripts/test-small-groups.js
require('dotenv').config();
const { io } = require('socket.io-client');
const URL = `http://localhost:${process.env.PORT || 3000}`;
const PIN = process.env.TEACHER_PIN || '0000';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0;
const check = (name, ok, extra = '') => { if (!ok) fail++; console.log(`${ok ? '통과' : '실패'}  ${name} ${extra}`); };

async function kid(code, nick, groupIdx) {
  const s = io(URL, { transports: ['websocket'], forceNew: true });
  await new Promise((r) => s.on('connect', r));
  await s.emitWithAck('join', { code, nick, groupIdx });
  return s;
}

(async () => {
  const t = io(URL, { transports: ['websocket'] });
  let R = null;
  t.on('room-state', (r) => (R = r));
  await new Promise((r) => t.on('connect', r));
  await t.emitWithAck('teacher-auth', { pin: PIN });
  const { code } = await t.emitWithAck('create-room', { groupCount: 4, settings: { groupSize: 6 } });
  const socks = [];
  for (const n of ['가1', '가2', '가3', '가4']) socks.push(await kid(code, n, 0));
  for (const n of ['나1', '나2', '나3']) socks.push(await kid(code, n, 1));
  for (const n of ['다1', '다2']) socks.push(await kid(code, n, 3)); // 4모둠 2명, 3모둠은 비움
  await sleep(300);
  const r = await t.emitWithAck('start-game', { code, groupIdx: 'all' });
  await sleep(300);
  const st = R.groups.map((g) => g.state);
  check('전체 시작이 성공으로 처리됨', r.ok === true, JSON.stringify(r));
  check('4명 모둠 시작', st[0] === 'ROLE_REVEAL', st[0]);
  check('3명 모둠 시작', st[1] === 'ROLE_REVEAL', st[1]);
  check('빈 모둠은 그대로', st[2] === 'LOBBY', st[2]);
  check('2명 모둠은 그대로 + 안내', st[3] === 'LOBBY' && /3명보다 적어요/.test(r.msg), st[3]);
  const none = await t.emitWithAck('start-game', { code, groupIdx: 3 });
  check('2명 모둠 개별 시작은 거절', none.ok === false);
  socks.forEach((s) => s.close());
  t.close();
  console.log(fail ? `\n실패 ${fail}건` : '\n모두 통과');
  process.exit(fail ? 1 : 0);
})();
