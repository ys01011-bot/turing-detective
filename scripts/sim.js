// 시험용 봇: 교사 1 + 모둠마다 학생 봇을 붙여 정해진 판 수를 끝까지 진행한다.
// 사용: npm run sim -- --groups 4 --players 6 --games 2
//       npm run sim -- --code 123456 --group 0 --players 5   (이미 있는 방의 한 모둠에 봇만 넣기)
require('dotenv').config();
const { io } = require('socket.io-client');

const args = Object.fromEntries(
  process.argv.slice(2).reduce((a, x, i, arr) => (x.startsWith('--') ? [...a, [x.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]] : a), [])
);
const URL = args.url || `http://localhost:${process.env.PORT || 3000}`;
const PIN = String(args.pin || process.env.TEACHER_PIN || '0000');
const GROUPS = Number(args.groups || 1);
const PLAYERS = Number(args.players || 6);
const GAMES = Number(args.games || 2);
const ONLY_BOTS = !!args.code;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

const LINES = [
  '나 저번에 체육 시간에 넘어졌는데 친구가 보건실 같이 가 줌',
  '몇일 전에 짝꿍이 지우개 빌려줬어 ㅋㅋ',
  '친구가 내 생일 기억해서 편지 써 줬음 감동이었어',
  '나는 같이 떡볶이 먹으러 가자고 할 듯 ㅋㅋ',
  '속상하면 일단 놀이터 가서 그네 같이 탈 것 같아',
  '그건 좀 어렵다 ㅠㅠ 그래도 옆에 있어 줄께',
  '친구 시험 잘 봤을 때 나도 기뻤는데 솔직히 좀 부러웠음',
  '서로 거짓말 안 하는 거? 그게 제일 중요함',
];
const REASONS = ['경험을 말하는데 언제 어디서인지가 없었어', '감정만 말하고 이유가 없어서', '말로만 도와준다고 하고 같이 뭘 하자는 게 없음', '답장이 너무 빨랐어', '맞춤법이 너무 정확했음'];
const pick = (a) => a[Math.floor(Math.random() * a.length)];

function makeBot(code, groupIdx, nick, opts = {}) {
  const s = io(URL, { transports: ['websocket'], forceNew: true });
  const bot = { s, nick, st: null, id: null, sentTurn: null, voted: 0, acked: 0, polled: false, pledged: false, greeted: false };
  s.on('connect', () => {
    if (bot.id) s.emit('resume', { code, playerId: bot.id });
    else
      s.emit('join', { code, nick, groupIdx }, (r) => {
        if (!r.ok) return log('join 실패', nick, r.msg);
        bot.id = r.playerId;
      });
  });
  s.on('state', async (st) => {
    bot.st = st;
    const g = st.group;
    if (g.state === 'LOBBY') {
      if (!bot.greeted) {
        bot.greeted = true;
        await sleep(200 + Math.random() * 500);
        s.emit('greeting', { text: pick(['안녕 오늘 기분 좋음 ㅋㅋ', '배고프다 ㅠㅠ', '오늘 날씨 좋아서 기분 좋아', '졸려…', '안녕!! 반가워']) });
      }
      if (!bot.polled) {
        bot.polled = true;
        s.emit('poll', { which: 'pre', choice: Math.floor(Math.random() * 3) });
      }
    }
    if (g.state === 'ROLE_REVEAL' && bot.acked < g.game) {
      bot.acked = g.game;
      await sleep(300 + Math.random() * 1000);
      s.emit('ack-role');
    }
    if (g.state === 'PLAYING' && g.turn && g.turn.playerId === st.me.id) {
      const key = `${g.game}-${g.round}-${g.turn.idx}`;
      if (bot.sentTurn === key) return;
      if (st.me.role === 'mafia') {
        if (!st.ghost || !st.ghost.text) {
          s.emit('typing', { pos: 0 });
          return;
        }
        bot.sentTurn = key;
        const n = [...st.ghost.text].length;
        for (let p = 0; p <= n; p += 2) {
          s.emit('typing', { pos: Math.min(p, n) });
          await sleep(60);
        }
        s.emit('typing', { pos: n });
        await sleep(150);
        s.emit('send', {}, (r) => !r.ok && log('마피아 send 실패', nick, r.msg));
      } else {
        bot.sentTurn = key;
        const text = pick(LINES);
        for (let i = 1; i <= 3; i++) {
          s.emit('typing', { draft: text.slice(0, i * 5) });
          await sleep(150);
        }
        if (opts.silent) return; // 시간 초과 시험
        s.emit('send', { text }, (r) => !r.ok && log('send 실패', nick, r.msg));
      }
    }
    if (g.state === 'VOTING' && g.vote && !g.vote.done && bot.voted < g.game) {
      bot.voted = g.game;
      await sleep(300 + Math.random() * 800);
      const others = g.members.filter((m) => m.id !== st.me.id);
      s.emit('vote', { targetId: pick(others).id, reason: pick(REASONS) }, (r) => !r.ok && log('vote 실패', nick, r.msg));
    }
    if (g.state === 'CLOSING' && !bot.pledged) {
      bot.pledged = true;
      s.emit('poll', { which: 'post', choice: Math.floor(Math.random() * 3) });
      s.emit('pledge', { text: 'AI 말도 한 번 더 확인할게' });
    }
  });
  return bot;
}

async function main() {
  if (ONLY_BOTS) {
    const gi = Number(args.group || 0);
    for (let i = 0; i < PLAYERS; i++) makeBot(args.code, gi, `봇${gi + 1}-${i + 1}`);
    log(`방 ${args.code} ${gi + 1}모둠에 봇 ${PLAYERS}명 입장. Ctrl+C 로 끝내요.`);
    return;
  }
  const t = io(URL, { transports: ['websocket'] });
  let room = null;
  t.on('room-state', (r) => (room = r));
  await new Promise((res) => t.on('connect', res));
  const auth = await t.emitWithAck('teacher-auth', { pin: PIN });
  if (!auth.ok) throw new Error('PIN 오류');
  const created = await t.emitWithAck('create-room', { groupCount: GROUPS, settings: { games: GAMES, turnSec: 20, voteSec: 60 } });
  const code = created.code;
  log('방 만듦', code);
  const bots = [];
  for (let g = 0; g < GROUPS; g++) for (let i = 0; i < PLAYERS; i++) bots.push(makeBot(code, g, `봇${g + 1}-${i + 1}`, { silent: args.silent && i === 1 }));
  await sleep(2500);
  for (let game = 1; game <= GAMES; game++) {
    const r = await t.emitWithAck('start-game', { code, groupIdx: 'all' });
    log(`${game}판 시작`, r.ok ? '' : r.msg);
    // 터치 지정(기본): 교사가 1모둠 터치 학생을 한 번 바꿔 보고, 모두 '고개 들기'
    const R = room;
    if (R && R.settings.mafiaPick === 'touch') {
      await sleep(800);
      const g0 = room.groups[0];
      const other = g0.members.find((m) => m.id !== g0.mafiaId && !m.wasMafia);
      if (other) {
        const sm = await t.emitWithAck('set-mafia', { code, groupIdx: 0, playerId: other.id });
        await sleep(300);
        log('터치 학생 바꾸기', sm.ok && room.groups[0].mafiaId === other.id ? '통과' : '실패 ' + JSON.stringify(sm));
      }
      const b = await t.emitWithAck('begin-chat', { code, groupIdx: 'all' });
      log('고개 들기', b.ok ? '통과' : '실패 ' + b.msg);
    }
    // 재접속 시험: 1모둠 3번째 봇이 2초 끊겼다가 돌아온다
    if (game === 1) {
      setTimeout(() => {
        log('재접속 시험: 봇1-3 끊김');
        bots[2].s.disconnect();
        setTimeout(() => bots[2].s.connect(), 2000);
      }, 6000);
    }
    const t0 = Date.now();
    while (!room || !room.groups.every((g) => g.state === 'RESULT' && g.game === game)) {
      await sleep(1000);
      if (Date.now() - t0 > 10 * 60 * 1000) throw new Error('시간 초과');
    }
    for (const g of room.groups) {
      const res = g.results[game - 1];
      log(`  ${g.idx + 1}모둠: 마피아=${res.mafiaNick} 검거=${res.caught} 득표=${res.tally.map((x) => x.nick + ':' + x.count).join(' ')} 메시지=${g.messages.filter((m) => m.game === game).length}개 AI=${res.aiMessageIds.length}개`);
    }
  }
  await t.emitWithAck('closing', { code });
  await sleep(2000);
  log('근거 분류:', room.evidence.map((e) => e.label).join(','));
  log('점수:', room.groups.map((g) => g.members.map((m) => `${m.nick}=${m.score}`).join(' ')).join(' | '));
  log('사전/사후:', JSON.stringify(room.poll.pre), JSON.stringify(room.poll.post), '약속', room.pledges.length);
  log('AI 메시지 예:', room.groups[0].messages.filter((m) => m.isAI).map((m) => m.text).join(' / '));
  log('보정된 메시지 예:', room.groups[0].messages.filter((m) => m.original).map((m) => `${m.original} → ${m.text}`).slice(0, 3).join(' / '));
  if (!args.keep) {
    await t.emitWithAck('close-room', { code });
    log('방 삭제 완료');
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
