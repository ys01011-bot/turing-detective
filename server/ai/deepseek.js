// DeepSeek API 어댑터 (OpenAI 형식 REST, 별도 패키지 없음).
// 환경변수: DEEPSEEK_API_KEY (필수), MAFIA_MODEL / CORRECT_MODEL / CLASSIFY_MODEL (선택, 기본 deepseek-chat)
const URL = 'https://api.deepseek.com/chat/completions';

const modelFor = (purpose) =>
  (purpose === 'mafia' && process.env.MAFIA_MODEL) ||
  (purpose === 'correct' && process.env.CORRECT_MODEL) ||
  (purpose === 'classify' && process.env.CLASSIFY_MODEL) ||
  'deepseek-chat';

const TEMP = { mafia: 1.1, correct: 0, classify: 0 };

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
  };
  const res = await fetch(URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (json.error && json.error.message) || `HTTP ${res.status}`;
    throw Object.assign(new Error(`deepseek ${res.status}: ${msg.slice(0, 200)}`), { status: res.status });
  }
  const text = ((json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content) || '').trim();
  if (!text) throw Object.assign(new Error('deepseek empty'), { status: 502 });
  return { text, latencyMs: Date.now() - t0, model };
}

module.exports = { generate, name: 'deepseek', modelFor };
