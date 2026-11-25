// AI 공급사 어댑터 선택. generate({ system, messages, maxTokens, purpose, mock }) → { text, latencyMs }
// mock · gemini · deepseek 구현. 키가 없거나 호출이 실패하면 백업 메시지로 넘어간다(mafia.js).
const provider = (process.env.AI_PROVIDER || 'mock').toLowerCase();

let impl;
try {
  impl = require('./' + provider);
} catch (e) {
  console.warn(`[ai] '${provider}' 어댑터가 아직 없어 mock 으로 동작합니다.`);
  impl = require('./mock');
}

class AITimeout extends Error {}

// ── 분당 호출 예산 ─────────────────────────────────
// Gemini 무료 등급은 모델당 분당 15회. 맞춤법 보정(correct)은 '낮은 우선순위'라서
// 예산의 일부만 쓰고, 나머지는 마피아 문장용으로 남겨 둔다. 한도 초과(429)를 받으면
// 알려 준 시간 동안 보정은 AI를 건너뛰고 규칙 보정만 쓴다.
const RPM = Number(process.env.AI_RPM) || (impl.name === 'gemini' ? 15 : 0); // 0 = 제한 없음
const RESERVE = Number(process.env.AI_RPM_RESERVE) || 6; // 마피아·분류용으로 남겨 둘 몫
const LOW = new Set(['correct']);
const recent = []; // 최근 60초 호출 시각
let cooldownUntil = 0;

function budgetOk(purpose) {
  if (!RPM || !LOW.has(purpose)) return true;
  const now = Date.now();
  while (recent.length && now - recent[0] > 60000) recent.shift();
  if (now < cooldownUntil) return false;
  return recent.length < RPM - RESERVE;
}

/** 시간 제한을 두고 호출한다. room 이 있으면 방당 호출 상한을 센다. */
async function generate(params, { timeoutMs = 6000, room } = {}) {
  if (!budgetOk(params.purpose)) {
    const e = new Error('budget');
    e.code = 'RATE_SKIP';
    throw e;
  }
  if (room) {
    if (room.aiCalls >= room.settings.aiCallLimit) {
      const e = new Error('limit');
      e.code = 'ROOM_LIMIT';
      throw e;
    }
    room.aiCalls++;
  }
  recent.push(Date.now());
  let timer;
  const timeout = new Promise((_, rej) => {
    timer = setTimeout(() => rej(new AITimeout('timeout')), timeoutMs);
  });
  try {
    return await Promise.race([impl.generate(params), timeout]);
  } catch (e) {
    if (e.status === 429) cooldownUntil = Date.now() + (e.retryAfterMs || 30000);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { generate, providerName: impl.name, AITimeout };
