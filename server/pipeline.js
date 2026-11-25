// 7장 메시지 처리 과정: 사람·AI 공통.
// ① 기본 정리 → ② 금칙어 → ③ 규칙 보정 → ④ AI 보정(선택, 1.5초) → ⑤ 변경량 점검
const content = require('./content');
const ai = require('./ai');

const EMOJI_RE = /[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{FE0F}\u{200D}\u{20E3}]/gu;

function clean(text, maxLen) {
  let t = String(text || '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(EMOJI_RE, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  if (maxLen && [...t].length > maxLen) t = [...t].slice(0, maxLen).join('').trim();
  return t;
}

function findBanned(text) {
  const b = content.banned();
  const squashed = text.replace(/[\s.,!?~\-_*^'"]/g, '');
  const hits = b.words.filter((w) => squashed.includes(w.replace(/\s/g, '')));
  for (const p of b.personalInfoPatterns || []) {
    if (new RegExp(p).test(text)) hits.push('(개인정보)');
  }
  return hits;
}

// 받침 번호: 0=없음, 4=ㄴ, 8=ㄹ
const jong = (ch) => {
  const c = ch.charCodeAt(0) - 0xac00;
  return c >= 0 && c < 11172 ? c % 28 : -1;
};

// 의존 명사 띄어쓰기: '할수있어'→'할 수 있어', '그런거같아'→'그런 거 같아' (관형형 ㄴ/ㄹ 받침 뒤만)
function boundNounSpacing(t) {
  return t
    .replace(/([가-힣])(수|줄)\s?(있|없|알|몰)/g, (m, a, b, c) => (jong(a) === 8 ? `${a} ${b} ${c}` : m))
    .replace(/([가-힣])(거|것)\s?(같)/g, (m, a, b, c) => (jong(a) === 4 || jong(a) === 8 ? `${a} ${b} ${c}` : m));
}

function ruleCorrect(text) {
  const s = content.spelling();
  let t = text;
  for (const [wrong, right] of [...s.rules, ...(s.spacing || [])]) {
    if (wrong && t.includes(wrong)) t = t.split(wrong).join(right);
  }
  t = boundNounSpacing(t);
  return t.replace(/\s{2,}/g, ' ').trim();
}

function editDistance(a, b) {
  a = [...a];
  b = [...b];
  const dp = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length];
}

async function aiCorrect(room, text) {
  if (!room.settings.spellAI) return text;
  try {
    const r = await ai.generate(
      {
        purpose: 'correct',
        system: content.prompts().correctSystem,
        messages: [{ role: 'user', content: text }],
        maxTokens: 200,
      },
      { timeoutMs: 1900, room }
    );
    const out = clean(r.text, room.settings.maxLen);
    if (!out) return text;
    return out;
  } catch (e) {
    console.log(`[보정] AI 보정 실패(${e.message.slice(0, 60)}) → 규칙 보정 결과 사용`);
    return text; // 실패하면 규칙 보정 결과로
  }
}

/**
 * @returns {Promise<{ok:boolean, text?:string, original:string, banned?:string[], reason?:string}>}
 */
async function processMessage(room, raw) {
  const original = clean(raw, room.settings.maxLen);
  if (!original) return { ok: false, original, reason: 'empty' };
  const banned = findBanned(original);
  if (banned.length) return { ok: false, original, banned, reason: 'banned' };
  const ruled = ruleCorrect(original);
  let final = ruled;
  const aiOut = await aiCorrect(room, ruled);
  if (aiOut !== ruled) {
    const ratio = editDistance(original, aiOut) / Math.max(1, [...original].length);
    final = ratio > 0.3 ? ruled : aiOut;
  }
  // AI 보정이 금칙어를 만들어 내는 경우까지 막는다
  if (findBanned(final).length) final = ruled;
  return { ok: true, text: final, original };
}

module.exports = { processMessage, clean, findBanned, ruleCorrect, editDistance };
