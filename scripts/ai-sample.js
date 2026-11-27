// AI 마피아 문장 견본 뽑기 — 가짜 모둠 대화를 만들어 generateMafiaMessage 결과를 출력한다.
// 사용: node scripts/ai-sample.js [사례번호...] [--n=2] [--dry]
//   --dry : API를 부르지 않고 첫 사례의 프롬프트(시스템+대화)만 출력
//   사례번호를 생략하면 모든 사례. 실제 호출은 .env 의 AI_PROVIDER 를 따른다(키는 출력하지 않음).
const path = require('path');
const R = path.join(__dirname, '..');
require('dotenv').config({ path: path.join(R, '.env') });
const mafia = require(path.join(R, 'server', 'mafia'));

const args = process.argv.slice(2);
const N = Number((args.find((a) => a.startsWith('--n=')) || '--n=2').slice(4));
const DRY = args.includes('--dry');
const picks = args.filter((a) => /^\d+$/.test(a)).map(Number);

const PEOPLE = [
  ['p1', '하늘', '안녕 ㅋㅋ'],
  ['p2', '민트초코', '졸려 ㅠㅠ'],
  ['p3', '도윤', 'ㅎㅇ'],
  ['p4', '감자', '오늘 급식 카레라 기분 좋음'], // 마피아
  ['p5', '서아', '하이하이'],
  ['p6', '별빛', '배고프다'],
];
const MAFIA = 'p4';

const BAL1 = [
  ['하늘', '무조건 치킨 ㅋㅋ 떡볶이는 맵기만 하고 배 안 부름'],
  ['민트초코', '떡볶이지 학원 앞 컵떡볶이 500원짜리 진짜 맛있음'],
  ['도윤', '치킨 근데 뿌링클만 먹을 거임'],
];
const BAL2_AFTER = [['서아', '나도 떡볶이 엽떡 먹으면 스트레스 다 풀림'], ['별빛', '치킨 평생 먹으면 살찔 듯 ㅋㅋ 그래도 치킨']];
const BAL2 = [
  ['하늘', '민트초코 컵떡볶이 500원은 사기 아님? ㅋㅋ 그래도 치킨'],
  ['민트초코', '하늘 진짜 500원임 우리 동네 와 봐'],
];
const BLU1 = [
  ['하늘', '체육 시간에 피구하다가 공 피하려다 혼자 넘어짐 ㅋㅋ'],
  ['민트초코', '엘리베이터에서 방귀 꼈는데 모르는 아저씨랑 둘만 있었음 ㅠㅠ'],
  ['도윤', '선생님한테 엄마라고 부름 애들 다 웃어서 귀까지 빨개짐'],
];
const BLU2_AFTER = [['서아', '나는 짝사랑하는 애 앞에서 우유 쏟음 ㅋㅋ'], ['별빛', '학예회 때 대사 까먹어서 그냥 서 있었음']];
const BLU2 = [
  ['하늘', '민트초코 아저씨 반응 어땠음? ㅋㅋㅋ'],
  ['민트초코', '하늘 모른 척해 주심 근데 더 창피했음'],
];

function msgs(list, round) {
  return list.map(([nick, text], i) => ({ id: `${round}-${i}`, game: 1, round, nick, text, isAI: nick === '감자', pass: false }));
}

function lap(round, before, after, own) {
  // before: 마피아 앞, own: 마피아 말(있으면), after: 마피아 뒤
  const L = [...before];
  if (own) L.push(['감자', own]);
  if (after) L.push(...after);
  return msgs(L, round);
}

const CASES = [
  { name: '밸런스 1바퀴 · 허점 없음', set: 'balance', round: 1, flaw: null, history: () => lap(1, BAL1) },
  { name: '밸런스 1바퀴 · agree', set: 'balance', round: 1, flaw: { id: 'agree', laps: [1] }, history: () => lap(1, BAL1) },
  {
    name: '밸런스 2바퀴 · 허점 없음 (내 1바퀴 말 있음)',
    set: 'balance',
    round: 2,
    flaw: { id: 'agree', laps: [1] },
    history: () => [...lap(1, BAL1, BAL2_AFTER, '떡볶이 ㅋㅋ 치킨은 금방 질림 떡볶이는 매일 먹어도 안 질려'), ...lap(2, BAL2)],
  },
  {
    name: '밸런스 2바퀴 · agree (내 1바퀴 말 있음)',
    set: 'balance',
    round: 2,
    flaw: { id: 'agree', laps: [2] },
    history: () => [...lap(1, BAL1, BAL2_AFTER, '떡볶이 ㅋㅋ 치킨은 금방 질림 떡볶이는 매일 먹어도 안 질려'), ...lap(2, BAL2)],
  },
  { name: '흑역사 1바퀴 · emotion', set: 'blunder', round: 1, flaw: { id: 'emotion', laps: [1] }, history: () => lap(1, BLU1) },
  { name: '흑역사 1바퀴 · 허점 없음', set: 'blunder', round: 1, flaw: null, history: () => lap(1, BLU1) },
  {
    name: '흑역사 2바퀴 · 허점 없음 (내 1바퀴 말 있음)',
    set: 'blunder',
    round: 2,
    flaw: { id: 'experience', laps: [1] },
    history: () => [...lap(1, BLU1, BLU2_AFTER, '수학 시간에 졸다가 이름 불려서 벌떡 일어남 ㅋㅋ'), ...lap(2, BLU2)],
  },
  {
    name: '흑역사 2바퀴 · pattern (내 1바퀴 말 있음)',
    set: 'blunder',
    round: 2,
    flaw: { id: 'pattern', laps: [2] },
    history: () => [...lap(1, BLU1, BLU2_AFTER, '수학 시간에 졸다가 이름 불려서 벌떡 일어남 ㅋㅋ'), ...lap(2, BLU2)],
  },
];

function makeRoom(setId) {
  const players = new Map(PEOPLE.map(([id, nick, greeting]) => [id, { id, nick, greeting }]));
  return {
    players,
    settings: { levels: ['Lv2'], rounds: 2, spellAI: false, maxLen: 80, aiCallLimit: 999 },
    gameCfg: [{ setId }],
    usedBackups: new Set(),
    aiCalls: 0,
  };
}

async function main() {
  const list = picks.length ? picks.map((i) => [i, CASES[i - 1]]).filter(([, c]) => c) : CASES.map((c, i) => [i + 1, c]);
  let calls = 0;
  for (const [no, c] of list) {
    const room = makeRoom(c.set);
    const group = { idx: 0, game: 1, round: c.round, playerIds: PEOPLE.map((p) => p[0]), flaw: c.flaw, messages: c.history() };
    const me = room.players.get(MAFIA);
    if (DRY) {
      const content = require(path.join(R, 'server', 'content'));
      const roundInfo = content.getRound(room.gameCfg[0], c.round);
      const prof = mafia.computeProfile(room, group, me, 'Lv2');
      const { directive } = content.flawDirective(group.flaw, group.round, 'Lv2');
      const p = mafia.buildPrompt(room, group, me, roundInfo, 'Lv2', prof, directive);
      console.log(`=== [${no}] ${c.name}\n--- system\n${p.system}\n--- user\n${p.messages[0].content}\n--- range ${prof.range}`);
      continue;
    }
    console.log(`\n=== [${no}] ${c.name}`);
    for (let i = 0; i < N; i++) {
      room.usedBackups.clear();
      const r = await mafia.generateMafiaMessage(room, group, me);
      console.log(`  ${r.source.padEnd(6)} ${r.note || ''}${r.flaw ? ` [${r.flaw}]` : ''}\n    → ${r.text}`);
    }
    calls += room.aiCalls;
  }
  if (!DRY) console.log(`\nAPI 호출 수: ${calls}`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
