// 6장: AI 마피아 메시지 생성 — 말투 프로필, 프롬프트 조립, 사후 점검, 백업 메시지.
const content = require('./content');
const ai = require('./ai');
const { processMessage, clean, findBanned } = require('./pipeline');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const len = (s) => [...s].length;
const KK = /[ㅋㅎ]{2,}/;
const TT = /[ㅠㅜ]{2,}/;
const AI_WORDS = /AI|ai|인공지능|로봇|챗봇|언어\s?모델|컴퓨터/;

function levelFor(room, game) {
  return room.settings.levels[game - 1] || 'Lv2';
}

/** 말투 견본: 모둠 입장 인사 + 이번 수업의 모둠 사람 메시지(게시된 문장 기준) */
function samples(room, group) {
  const greet = group.playerIds
    .map((id) => room.players.get(id))
    .filter((p) => p && p.greeting)
    .map((p) => p.greeting);
  const msgs = group.messages.filter((m) => !m.isAI && !m.pass).map((m) => m.text);
  return [...greet, ...msgs];
}

function endingOf(s) {
  const words = s.replace(/[ㅋㅎㅠㅜ.!?~,]+/g, ' ').trim().split(/\s+/);
  const w = words[words.length - 1] || '';
  return w.slice(-1);
}

function computeProfile(room, group, mafia, level) {
  const S = samples(room, group);
  const lengths = S.map(len);
  let lo = 15;
  let hi = 35;
  if (S.length >= 3) {
    lo = Math.max(5, Math.min(...lengths));
    hi = Math.max(lo + 3, Math.max(...lengths));
  }
  const target = Math.round(lo + Math.random() * (hi - lo));
  const rate = (re) => (S.length ? S.filter((s) => re.test(s)).length / S.length : 0);
  const pKK = rate(KK);
  const pTT = rate(TT);
  const pQ = rate(/\?/);
  const pEx = rate(/!/);
  const pDot = rate(/\.$/);
  const endCount = {};
  for (const s of S) {
    const e = endingOf(s);
    if (e) endCount[e] = (endCount[e] || 0) + 1;
  }
  const endings = Object.entries(endCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([e]) => e);
  // 앞사람 반응 비율
  const ms = group.messages.filter((m) => !m.pass);
  let replies = 0;
  let humanCount = 0;
  ms.forEach((m, i) => {
    if (m.isAI) return;
    humanCount++;
    const prev = ms[i - 1];
    if (/^(나도|ㅇㅈ|맞아|ㄹㅇ|인정)/.test(m.text) || (prev && m.text.includes(prev.nick))) replies++;
  });
  const q = humanCount ? replies / humanCount : 0;
  // ㅋㅋ와 ㅠㅠ가 한 문장에 같이 붙으면 어색하다 → 하나만
  let useKK = Math.random() < pKK;
  let useTT = Math.random() < pTT;
  if (useKK && useTT) Math.random() < 0.5 ? (useKK = false) : (useTT = false);
  const prof = {
    target,
    range: [lo, hi],
    useKK,
    useTT,
    pQ,
    pEx,
    pDot,
    endings,
    reply: Math.random() < q,
    own: level === 'Lv3' ? mafia.greeting || '' : '',
  };
  const lines = [
    `목표 길이: ${target}자 안팎`,
    prof.useKK ? 'ㅋㅋ/ㅎㅎ: 웃기거나 가벼운 내용이면 어울리는 자리에 넣어도 됨(슬픈 내용엔 넣지 않음)' : 'ㅋㅋ/ㅎㅎ: 이번 메시지에 넣지 않음',
    prof.useTT ? 'ㅠㅠ: 아쉽거나 속상한 내용이면 어울리는 자리에 넣어도 됨' : 'ㅠㅠ: 이번 메시지에 넣지 않음',
    endings.length ? `끝맺음은 ${endings.map((e) => `'~${e}'`).join(', ')} 중에서` : '끝맺음은 자유롭게',
    pQ < 0.15 ? '물음표 거의 안 씀' : '물음표 가끔 씀',
    pEx < 0.15 ? '느낌표 거의 안 씀' : '느낌표 가끔 씀',
    prof.reply ? '이번엔 직전 메시지에 짧게 반응하고 시작' : '직전 메시지에 반응하지 않고 바로 말함',
  ];
  if (prof.own) lines.push(`너의 평소 말투: '${prof.own}'와 비슷하게 (모둠 평균보다 우선)`);
  prof.text = lines.join('\n');
  return prof;
}

function fill(tpl, vars) {
  return tpl.replace(/\{(\w+)\}/g, (_, k) => (vars[k] !== undefined ? vars[k] : `{${k}}`));
}

// 예시 속 {친구} 자리를 실제 모둠원 별명으로 바꾼다
function exampleText(ex, group, room) {
  const nicks = group.playerIds.map((id) => room.players.get(id)?.nick).filter(Boolean);
  const n = nicks.length ? pick(nicks) : '';
  return ex.replace(/\{친구\}이?\s?/g, n ? `${n} ` : '');
}

function buildPrompt(room, group, mafia, roundInfo, level, profile, directive) {
  const P = content.prompts();
  const examples = roundInfo.examples.map((e) => '- ' + exampleText(e, group, room)).join('\n');
  const system = fill(P.mafiaSystem, {
    nick: mafia.nick,
    game: group.game,
    round: group.round,
    question: roundInfo.question,
    clueDirective: directive,
    examples,
    profile: profile.text,
  });
  const lines = [];
  for (const id of group.playerIds) {
    const p = room.players.get(id);
    if (p && p.greeting) lines.push(`(입장 인사) ${p.nick}: ${p.greeting}`);
  }
  for (const m of group.messages) {
    const tag = m.game < group.game ? `(이전 판 ${m.round}바퀴)` : `(${m.round}바퀴)`;
    lines.push(`${tag} ${m.nick}: ${m.pass ? '(패스)' : m.text}`);
  }
  return { system, messages: [{ role: 'user', content: '[대화]\n' + lines.join('\n') }] };
}

function hasCommon(a, b, k) {
  const A = a.replace(/\s/g, '');
  const B = b.replace(/\s/g, '');
  if (A.length < k || B.length < k) return false;
  for (let i = 0; i + k <= A.length; i++) if (B.includes(A.slice(i, i + k))) return true;
  return false;
}

/** 6.5 사후 점검 — 문제가 있으면 이유 문자열, 없으면 null */
function postCheck(text, profile, group, roundInfo) {
  const n = len(text);
  if (!n) return 'empty';
  // 길이 기준: 모둠 견본의 최소~최대 범위에 여유를 둔다(목표 길이 한 점이 아니라 범위로 판정).
  const [lo, hi] = profile.range;
  if (n < Math.max(4, Math.floor(lo * 0.6)) || n > Math.max(Math.ceil(hi * 1.4), lo + 12)) return 'length';
  // 끝이 띄어 쓴 한 글자 어미로 깨진 문장(예: "들어 줄 어")
  if (/\s[어아요야]$/.test(text.replace(/[\s.!?~ㅋㅎㅠㅜ]+$/, ''))) return 'broken';
  if (AI_WORDS.test(text)) return 'ai-word';
  const prev = [...group.messages.filter((m) => !m.pass).map((m) => m.text), ...roundInfo.examples];
  for (const p of prev) if (hasCommon(text, p, 10)) return 'copy';
  return null;
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stripOutput(text, nick) {
  let t = clean(text);
  t = t.replace(/^["'“”‘’「」『』\s]+|["'“”‘’「」『』\s]+$/g, '');
  t = t.replace(new RegExp(`^(${escapeRe(nick)}|나)\\s*[:：]\\s*`), '');
  t = t.replace(/[^\p{L}\p{N}\s.,!?~'"-]/gu, '');
  return t.trim();
}

/** 6.6 백업 메시지에 프로필을 코드로 적용 */
function applyProfile(text, profile) {
  let t = text;
  if (profile.useKK && !KK.test(t)) t += ' ㅋㅋ';
  if (!profile.useKK) t = t.replace(/\s?[ㅋㅎ]{2,}/g, '');
  if (profile.useTT && !TT.test(t)) t += ' ㅠㅠ';
  if (!profile.useTT) t = t.replace(/\s?[ㅠㅜ]{2,}/g, '');
  if (profile.pDot > 0.5 && !/[.?!ㅋㅎㅠㅜ]$/.test(t)) t += '.';
  if (profile.pDot < 0.2) t = t.replace(/\.$/, '');
  return t.trim();
}

function pickBackup(room, roundInfo, profile) {
  const key = (s) => `${roundInfo.question}|${s}`;
  let pool = roundInfo.backups.filter((b) => !room.usedBackups.has(key(b)));
  if (!pool.length) pool = roundInfo.backups; // 다 썼으면 어쩔 수 없이 재사용
  const b = pick(pool);
  room.usedBackups.add(key(b));
  return applyProfile(b, profile);
}

async function callWithRetry(room, prompt, roundInfo) {
  const params = { ...prompt, purpose: 'mafia', maxTokens: 300, mock: { candidates: roundInfo.backups } };
  try {
    return await ai.generate(params, { timeoutMs: 6000, room });
  } catch (e) {
    if (e.status === 429) {
      await sleep(2000);
      return ai.generate(params, { timeoutMs: 6000, room });
    }
    throw e;
  }
}

/**
 * 마피아 메시지 하나를 만든다. 결과 문장은 이미 7장 보정을 거친 상태이다.
 * @returns {Promise<{text, latencyMs, source:'ai'|'backup', flaw?:string|null, note?:string, alert?:string}>}
 */
async function generateMafiaMessage(room, group, mafia, opts = {}) {
  const t0 = Date.now();
  const roundInfo = content.getRound(room.gameCfg[group.game - 1], group.round);
  const level = levelFor(room, group.game);
  const profile = computeProfile(room, group, mafia, level);
  const backup = async (note, alert) => {
    const text = pickBackup(room, roundInfo, profile);
    const r = await processMessage(room, text);
    return { text: r.ok ? r.text : text, latencyMs: Date.now() - t0, source: 'backup', note, alert };
  };
  if (opts.forceBackup) return backup('teacher');
  // 지도서의 AI 한계 중 이번 판에 정한 허점을, 정해진 바퀴에만 옅게 남긴다(content/flaws.json)
  const { flaw, directive } = content.flawDirective(group.flaw, group.round, level);
  const prompt = buildPrompt(room, group, mafia, roundInfo, level, profile, directive);
  // 미리 저장된 백업 문장은 '사람 같지 않음'의 가장 큰 원인이다. 점검에 걸리면 이유를 알려 주고 다시 쓰게 하고,
  // 백업은 API 오류이거나 세 번 모두 걸렸을 때만 쓴다.
  const reasons = [];
  for (let attempt = 0; attempt < 3; attempt++) {
    let out;
    try {
      out = await callWithRetry(room, prompt, roundInfo);
    } catch (e) {
      return backup(e.code === 'ROOM_LIMIT' ? 'limit' : 'error');
    }
    const text = stripOutput(out.text, mafia.nick);
    if (findBanned(text).length) {
      return backup('banned', `AI 문장에 금칙어가 있어 백업 메시지로 바꿨어요 (${mafia.nick})`);
    }
    const why = postCheck(text, profile, group, roundInfo);
    if (!why) {
      const r = await processMessage(room, text);
      if (r.ok) return { text: r.text, latencyMs: Date.now() - t0, source: 'ai', flaw, note: reasons.length ? `retry:${reasons.join(',')}` : undefined };
      return backup('pipeline');
    }
    reasons.push(why);
    prompt.system += `

[다시 쓰기] 방금 쓴 문장("${text.slice(0, 80)}")은 쓸 수 없다: ${retryHint(why, profile)} 같은 뜻이라도 새로 써라.`;
  }
  return backup(`postcheck:${reasons.join(',')}`);
}

function retryHint(why, profile) {
  const [lo, hi] = profile.range;
  return (
    {
      length: `길이를 ${Math.max(4, lo)}~${hi}자 사이로 맞춰라.`,
      broken: '문장 끝이 어색하게 끊겼다. 자연스럽게 끝맺어라.',
      'ai-word': 'AI·로봇·컴퓨터 같은 말은 쓰지 마라.',
      copy: '친구 말이나 예시를 10자 넘게 그대로 따오지 말고, 친구 이름을 부르며 네 말로 바꿔 써라.',
      empty: '빈 문장이다. 메시지 본문을 써라.',
    }[why] || '점검에 걸렸다.'
  );
}

module.exports = { generateMafiaMessage, computeProfile, buildPrompt, postCheck, applyProfile };
