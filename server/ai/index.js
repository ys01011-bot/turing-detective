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

/** 시간 제한을 두고 호출한다. room 이 있으면 방당 호출 상한을 센다. */
async function generate(params, { timeoutMs = 6000, room } = {}) {
  if (room) {
    if (room.aiCalls >= room.settings.aiCallLimit) {
      const e = new Error('limit');
      e.code = 'ROOM_LIMIT';
      throw e;
    }
    room.aiCalls++;
  }
  let timer;
  const timeout = new Promise((_, rej) => {
    timer = setTimeout(() => rej(new AITimeout('timeout')), timeoutMs);
  });
  try {
    return await Promise.race([impl.generate(params), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { generate, providerName: impl.name, AITimeout };
