// Google Gemini API 어댑터 (REST, 별도 패키지 없음).
// 환경변수: GEMINI_API_KEY (필수), MAFIA_MODEL / CORRECT_MODEL / CLASSIFY_MODEL (선택)
const BASE = 'https://generativelanguage.googleapis.com/v1beta';

const DEFAULTS = {
  mafia: 'gemini-flash-latest',
  correct: 'gemini-flash-lite-latest',
  classify: 'gemini-flash-latest',
};
const modelFor = (purpose) =>
  (purpose === 'mafia' && process.env.MAFIA_MODEL) ||
  (purpose === 'correct' && process.env.CORRECT_MODEL) ||
  (purpose === 'classify' && process.env.CLASSIFY_MODEL) ||
  DEFAULTS[purpose] ||
  DEFAULTS.mafia;

const TEMP = { mafia: 1.0, correct: 0, classify: 0 };

// 모델마다 '생각 끄기' 방식이 다르다. 거절당하면 다음 방식으로 바꿔 기억해 둔다.
const THINK_OPTIONS = [{ thinkingBudget: 0 }, { thinkingLevel: 'minimal' }, { thinkingLevel: 'low' }, null];
const thinkIdx = new Map(); // model → THINK_OPTIONS 위치

function apiError(status, body) {
  const msg = (body && body.error && body.error.message) || `HTTP ${status}`;
  const e = new Error(`gemini ${status}: ${msg.slice(0, 200)}`);
  e.status = status;
  return e;
}

async function call(model, body) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw Object.assign(new Error('GEMINI_API_KEY 가 비어 있어요'), { status: 401 });
  const res = await fetch(`${BASE}/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw apiError(res.status, json);
  return json;
}

async function generate({ system, messages, maxTokens = 300, purpose = 'mafia' }) {
  const t0 = Date.now();
  const model = modelFor(purpose);
  const base = {
    contents: messages.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
    generationConfig: {
      temperature: TEMP[purpose] ?? 0.7,
      // 생각 토큰이 섞여도 답이 잘리지 않도록 넉넉히
      maxOutputTokens: Math.max(maxTokens, 1024),
      ...(purpose === 'classify' ? { responseMimeType: 'application/json' } : {}),
    },
  };
  if (system) base.systemInstruction = { parts: [{ text: system }] };

  let i = thinkIdx.get(model) ?? 0;
  for (;;) {
    const think = THINK_OPTIONS[i];
    const body = think ? { ...base, generationConfig: { ...base.generationConfig, thinkingConfig: think } } : base;
    try {
      const json = await call(model, body);
      thinkIdx.set(model, i);
      const cand = json.candidates && json.candidates[0];
      const text = ((cand && cand.content && cand.content.parts) || [])
        .filter((p) => !p.thought && typeof p.text === 'string')
        .map((p) => p.text)
        .join('')
        .trim();
      if (!text) {
        const why = (cand && cand.finishReason) || (json.promptFeedback && json.promptFeedback.blockReason) || 'EMPTY';
        throw Object.assign(new Error(`gemini empty (${why})`), { status: 502 });
      }
      return { text, latencyMs: Date.now() - t0, model };
    } catch (e) {
      // 생각 설정을 거절한 경우에만 다음 방식으로
      const thinkRejected = e.status === 400 && /think/i.test(e.message);
      if (thinkRejected && i < THINK_OPTIONS.length - 1) {
        i++;
        continue;
      }
      throw e;
    }
  }
}

module.exports = { generate, name: 'gemini', modelFor };
