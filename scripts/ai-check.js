// AI 연결 점검: 키가 맞는지, 쓸 수 있는 모델, 용도별 실제 호출 1회씩과 걸린 시간.
// 사용: npm run ai:check            (.env 의 AI_PROVIDER 기준)
//       npm run ai:check -- models  (Gemini: 이 키로 쓸 수 있는 모델 목록만)
// 키 값은 화면에 출력하지 않는다.
require('dotenv').config();
const content = require('../server/content');
const provider = (process.env.AI_PROVIDER || 'mock').toLowerCase();

async function listGeminiModels() {
  const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', {
    headers: { 'x-goog-api-key': process.env.GEMINI_API_KEY || '' },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`모델 목록 실패 ${res.status}: ${(json.error && json.error.message) || ''}`.slice(0, 200));
  return (json.models || [])
    .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
    .map((m) => m.name.replace(/^models\//, ''))
    .filter((n) => /gemini/.test(n) && !/image|tts|audio|live|embedding|robotics|computer/.test(n));
}

(async () => {
  console.log(`공급사: ${provider}`);
  const keyName = { gemini: 'GEMINI_API_KEY', deepseek: 'DEEPSEEK_API_KEY' }[provider];
  if (keyName) console.log(`${keyName}: ${process.env[keyName] ? `들어 있음 (${process.env[keyName].length}자)` : '비어 있음 ← .env 에 넣어 주세요'}`);
  if (provider === 'gemini') {
    try {
      const models = await listGeminiModels();
      console.log(`\n이 키로 쓸 수 있는 Gemini 모델 ${models.length}개:\n  ` + models.join('\n  '));
    } catch (e) {
      console.log('\n' + e.message);
      process.exitCode = 1;
      return;
    }
    if (process.argv.includes('models')) return;
  }
  const ai = require('../server/ai');
  const P = content.prompts();
  const tests = [
    {
      purpose: 'correct',
      system: P.correctSystem,
      messages: [{ role: 'user', content: '나는 몇일전에 친구가 도와줘서 할수있엇어 ㅋㅋ' }],
      maxTokens: 200,
      timeoutMs: 1900,
    },
    {
      purpose: 'mafia',
      system:
        '너는 초등학생 채팅 놀이에 참여한 학생 "반짝별"인 척한다. 질문: "친구를 배려한다는 건 어떤 걸까?" 앞사람들 말투처럼 반말로 20자 안팎 한 문장만 써. 따옴표·이름표 없이 문장만.',
      messages: [{ role: 'user', content: '[대화]\n(1바퀴) 하늘: 친구가 아플 때 가방 들어주는 거 ㅋㅋ\n(1바퀴) 바다: 나는 줄 설 때 양보하는 거' }],
      maxTokens: 300,
      timeoutMs: 6000,
    },
    {
      purpose: 'classify',
      system: P.classifySystem,
      messages: [
        {
          role: 'user',
          content: JSON.stringify([
            { id: 'a', text: '경험을 말하는데 언제 어디서인지가 없었어' },
            { id: 'b', text: '말로만 도와준다고 하고 행동이 없었어' },
            { id: 'c', text: '감정을 너무 교과서처럼 정리했어' },
          ]),
        },
      ],
      maxTokens: 2000,
      timeoutMs: 15000,
    },
  ];
  let fail = 0;
  for (const t of tests) {
    const name = ai.providerName === 'gemini' || ai.providerName === 'deepseek' ? require(`../server/ai/${ai.providerName}`).modelFor(t.purpose) : ai.providerName;
    try {
      const r = await ai.generate(t, { timeoutMs: t.timeoutMs });
      const slow = r.latencyMs > t.timeoutMs * 0.8 ? '  ⚠ 제한 시간에 가까움' : '';
      console.log(`\n[${t.purpose}] ${name}  ${r.latencyMs}ms / 제한 ${t.timeoutMs}ms${slow}\n  → ${r.text.replace(/\n/g, ' ').slice(0, 300)}`);
    } catch (e) {
      fail++;
      console.log(`\n[${t.purpose}] ${name}  실패: ${e.message}`);
    }
  }
  console.log(fail ? `\n실패 ${fail}건` : '\n모두 응답함');
  process.exitCode = fail ? 1 : 0;
})();
