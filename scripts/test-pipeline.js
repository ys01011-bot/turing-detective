// D4 처리 과정 점검: 맞춤법 규칙 보정, 금칙어 반려, 개인정보, 이모지 제거, 변경량 점검.
// 사용: node scripts/test-pipeline.js
const { processMessage, editDistance } = require('../server/pipeline');

const room = { settings: { maxLen: 80, spellAI: true, aiCallLimit: 300 }, aiCalls: 0 };
const cases = [
  ['몇일 전에 친구가 도와줬어 ㅋㅋ', (r) => r.ok && r.text.includes('며칠')],
  ['내일 같이 갈께 됬지?', (r) => r.ok && r.text === '내일 같이 갈게 됐지?'],
  ['어떻해 ㅠㅠ 금새 끝났어', (r) => r.ok && r.text === '어떡해 ㅠㅠ 금세 끝났어'],
  ['그럴수있어 그런거같아', (r) => r.ok && r.text === '그럴 수 있어 그런 거 같아'],
  ['할수없는 건 아니야', (r) => r.ok && r.text === '할 수 없는 건 아니야'],
  ['수영장 가자 이거같아', (r) => r.ok && r.text === '수영장 가자 이거 같아'],
  ['ㅋㅋㅋ 오늘 진짜 웃겼음 ㅇㅈ?', (r) => r.ok && r.text === 'ㅋㅋㅋ 오늘 진짜 웃겼음 ㅇㅈ?'],
  ['좋아 😀👍 진짜', (r) => r.ok && r.text === '좋아 진짜'],
  ['  띄어   쓰기\n줄바꿈  ', (r) => r.ok && r.text === '띄어 쓰기 줄바꿈'],
  ['너 진짜 ㅅ ㅂ 뭐야', (r) => !r.ok && r.reason === 'banned'],
  ['내 번호 010-1234-5678 이야', (r) => !r.ok && r.reason === 'banned'],
  ['', (r) => !r.ok && r.reason === 'empty'],
  ['가'.repeat(100), (r) => r.ok && [...r.text].length === 80],
];

(async () => {
  let fail = 0;
  for (const [input, check] of cases) {
    const t0 = Date.now();
    const r = await processMessage(room, input);
    const ok = check(r);
    if (!ok) fail++;
    console.log(`${ok ? '통과' : '실패'}  "${input.slice(0, 30)}" → ${r.ok ? `"${r.text.slice(0, 30)}"` : `반려(${r.reason})`}  ${Date.now() - t0}ms`);
  }
  console.log('편집 거리 예:', editDistance('할께', '할게'));
  console.log(fail ? `실패 ${fail}건` : '모두 통과');
  process.exit(fail ? 1 : 0);
})();
