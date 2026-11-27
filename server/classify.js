// 6.7 근거 자동 분류 — 방 전체 근거를 한 번에 묶어 1회 호출한다.
const content = require('./content');
const ai = require('./ai');

const LABELS = ['experience', 'emotion', 'agree', 'pattern', 'surface'];

async function classifyRoom(room) {
  const items = room.evidence.filter((e) => !e.label || e.label === 'unclassified'); // 실패했던 것도 다시
  if (!items.length) return;
  items.forEach((e) => (e.label = 'pending'));
  try {
    const r = await ai.generate(
      {
        purpose: 'classify',
        system: content.prompts().classifySystem,
        messages: [{ role: 'user', content: JSON.stringify(items.map((e) => ({ id: e.id, text: e.reason }))) }],
        maxTokens: 2000,
      },
      { timeoutMs: 15000, room }
    );
    const json = JSON.parse(r.text.replace(/^```(json)?|```$/g, '').trim());
    const map = new Map(json.map((x) => [x.id, x.label]));
    for (const e of items) {
      const l = map.get(e.id);
      e.label = LABELS.includes(l) ? l : 'unclassified';
    }
  } catch (err) {
    console.log(`[분류] AI 분류 실패(${String(err.message).slice(0, 60)}) → 교사 화면 '다시 분류'로 재시도 가능`);
    items.forEach((e) => (e.label = 'unclassified'));
  }
}

module.exports = { classifyRoom, LABELS };
