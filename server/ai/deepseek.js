// DeepSeek API 어댑터 (OpenAI 형식 REST, 별도 패키지 없음).
// 환경변수: DEEPSEEK_API_KEY (필수), MAFIA_MODEL / CORRECT_MODEL / CLASSIFY_MODEL (선택, 기본 deepseek-flash)
const URL = 'https://api.deepseek.com/chat/completions';

const modelFor = (purpose) =>
  (purpose === 'mafia' && process.env.MAFIA_MODEL) ||
  (purpose === 'correct' && process.env.CORRECT_MODEL) ||
  (purpose === 'classify' && process.env.CLASSIFY_MODEL) ||
  'deepseek-flash'; // 사용자 결정(2026-11-26): pro 가 아닌 flash

const TEMP = { mafia: 1.1, correct: 0, classify: 0 };
let thinkingOff = true;

async function generate({ system, messages, maxTokens = 300, purpose = 'mafia' }) {
  const t0 = Date.now();
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) throw Object.assign(new Error('DEEPSEEK_API_KEY 가 비어 있어요'), { status: 401 });
  const model = modelFor(purpose);
  const body = {
    model,
    messages: [...(system ? [{ role: 'system', content: system }] : []), ...messages],
    max_tokens: maxTokens,
    temperature: TEMP[purpose] ?? 0.7,
    // flash 는 기본으로 '생각'부터 해서 짧은 출력 한도를 다 쓰고 빈 답을 낸다 → 끈다(빠르기도 함)
    ...(thinkingOff ? { thinking: { type: 'disabled' } } : {}),
  };
  const post = (b) =>
    fetch(URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify(b),
      signal: AbortSignal.timeout(20000),
    });
  let res = await post(body);
  let json = await res.json().catch(() => ({}));
  if (res.status === 400 && body.thinking) {
    // 생각 끄기 설정을 받지 않는 모델이면 빼고 다시, 이후로는 넣지 않는다
    thinkingOff = false;
    delete body.thinking;
    res = await post(body);
    json = await res.json().catch(() => ({}));
  }
  if (!res.ok) {
    const msg = (json.error && json.error.message) || `HTTP ${res.status}`;
    throw Object.assign(new Error(`deepseek ${res.status}: ${msg.slice(0, 200)}`), { status: res.status });
  }
  const text = ((json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content) || '').trim();
  if (!text) throw Object.assign(new Error('deepseek empty'), { status: 502 });
  return { text, latencyMs: Date.now() - t0, model };
}

module.exports = { generate, name: 'deepseek', modelFor };
