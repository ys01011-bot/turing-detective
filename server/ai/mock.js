// 개발용 가짜 AI. 실제 API를 부르지 않는다.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rand = (a, b) => a + Math.random() * (b - a);

// 아주 단순한 낱말 규칙으로 근거를 분류한다(진짜 분류는 D5에서 AI로).
function mockClassify(text) {
  const t = text.replace(/\s/g, '');
  if (/맞장구|맞춰|동의|다맞|반대|자기생각|자기의견|싫은|편들/.test(t)) return 'agree';
  if (/모범|정답|교과서|정리|반듯|딱맞|농담|흐름|질문에만/.test(t)) return 'pattern';
  if (/경험|언제|어디|누가|구체|막연|장면|있었던|일이|적있|기억|흔한|뒷이야기/.test(t)) return 'experience';
  if (/감정|기분|마음|느낌|기뻐|슬퍼|속상|서운|짜증|질투|부러/.test(t)) return 'emotion';
  return 'surface';
}

async function generate({ purpose, messages, mock = {} }) {
  const t0 = Date.now();
  if (purpose === 'mafia') {
    await sleep(rand(1000, 2000));
    const c = mock.candidates || ['나도 그런 적 있는 듯'];
    return { text: c[Math.floor(Math.random() * c.length)], latencyMs: Date.now() - t0 };
  }
  if (purpose === 'correct') {
    await sleep(rand(150, 400));
    const last = messages[messages.length - 1].content;
    return { text: last, latencyMs: Date.now() - t0 };
  }
  if (purpose === 'classify') {
    await sleep(rand(300, 800));
    const items = JSON.parse(messages[messages.length - 1].content);
    const out = items.map((it) => ({ id: it.id, label: mockClassify(it.text) }));
    return { text: JSON.stringify(out), latencyMs: Date.now() - t0 };
  }
  throw new Error('unknown purpose');
}

module.exports = { generate, name: 'mock' };
