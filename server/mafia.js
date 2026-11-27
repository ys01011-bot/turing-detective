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

/** 마피아 본인의 메시지인가(이번 판·이전 판 모두). 같은 학생의 말이면 '나'로 본다 */
function isMe(m, mafia) {
  return m.playerId ? m.playerId === mafia.id : m.nick === mafia.nick;
}

/**
 * 말투 견본. 길이는 채팅 메시지(chat)로만 잰다 — 입장 인사("졸려 ㅠㅠ")는 너무 짧아 길이 범위를 망친다.
 * 말버릇(ㅋㅋ·끝맺음 등)은 채팅이 2개 이상이면 채팅으로, 그 전에는 인사까지 합쳐서 본다.
 */
function samples(room, group) {
  const greet = group.playerIds
    .map((id) => room.players.get(id))
    .filter((p) => p && p.greeting)
    .map((p) => p.greeting);
  const chat = group.messages.filter((m) => !m.isAI && !m.pass).map((m) => m.text);
  return { greet, chat, style: chat.length >= 2 ? chat : [...greet, ...chat] };
}

// 끝맺음 종류. 마지막 글자를 그대로 쓰면 '치킨'→'~킨', '안녕'→'~녕' 같은 엉뚱한 어미가 나오고
// AI가 그걸 붙여 '부럽킨', '최고려' 같은 없는 말을 만든다 → 실제 채팅 어미만 골라 묶는다.
const ENDING_WORDS = new Set('어 아 야 지 네 게 거 까 냐 니 래 데 봐 해 돼 다 듯 셈'.split(' '));
function endingOf(s) {
  const words = s.replace(/[ㅋㅎㅠㅜ.!?~,]+/g, ' ').trim().split(/\s+/);
  const w = words[words.length - 1] || '';
  const c = w.slice(-1);
  if (!c) return '';
  const code = c.charCodeAt(0) - 0xac00;
  if (c === '듯' || c === '셈') return `~${c}`;
  if (code >= 0 && code < 11172 && code % 28 === 16) return '~음/~함/~임'; // 받침 ㅁ: 명사형 끝맺음
  if (ENDING_WORDS.has(c)) return `~${c}`;
  return '명사로 끝내기'; // '그래도 치킨'처럼 낱말로 끝냄
}

const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)))];

/**
 * 누구에게 어떻게 반응할지. 허점이 pattern(흐름을 안 받음)이면 반응하지 않고,
 * agree(늘 맞춰 줌)이면 늘 맞장구 쪽으로만, 반박은 하지 않는다.
 */
function chooseReply(room, group, mafia, flaw, q) {
  const recent = group.messages.filter((m) => m.game === group.game && !m.pass && !isMe(m, mafia)).slice(-4);
  if (!recent.length || flaw === 'pattern') return { mode: 'none' };
  // 가까운 메시지일수록 잘 고른다(직전 2개에 무게)
  const w = recent.map((_, i) => (i >= recent.length - 2 ? 2 : 1));
  let r = Math.random() * w.reduce((a, b) => a + b, 0);
  let target = recent[recent.length - 1];
  for (let i = 0; i < recent.length; i++) if ((r -= w[i]) < 0) { target = recent[i]; break; }
  if (flaw === 'agree') return { mode: 'react', nick: target.nick };
  let pReact = Math.min(0.7, Math.max(0.35, q));
  if (group.round >= 2) pReact = Math.min(0.85, pReact + 0.25); // 2바퀴 안내: 친구 선택에 편들기·반박
  if (Math.random() >= pReact) return { mode: 'none' };
  const pTease = group.round >= 2 ? 0.4 : 0.2;
  return { mode: Math.random() < pTease ? 'tease' : 'react', nick: target.nick };
}

function computeProfile(room, group, mafia, level, flaw = null) {
  const { chat, style: S } = samples(room, group);
  const cl = chat.map(len).sort((a, b) => a - b);
  let lo = 15;
  let hi = 35;
  let target;
  if (cl.length >= 3) {
    lo = Math.max(8, cl[0]);
    hi = Math.max(lo + 6, cl[cl.length - 1]);
    // 범위 끝보다 가운데(사분위) 쪽에서 고른다 — 남들보다 유난히 길거나 짧으면 눈에 띈다
    const q1 = pct(cl, 0.25);
    const q3 = pct(cl, 0.75);
    target = q1 + Math.random() * (q3 - q1);
  } else if (cl.length) {
    const avg = cl.reduce((a, b) => a + b, 0) / cl.length;
    lo = Math.max(8, Math.min(15, Math.round(cl[0] * 0.7)));
    hi = Math.max(30, Math.round(cl[cl.length - 1] * 1.3));
    target = avg * (0.8 + Math.random() * 0.4);
  } else {
    target = 15 + Math.random() * 12;
  }
  target = Math.round(Math.min(hi, Math.max(lo, target)));
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
  const nicks = group.playerIds.map((id) => room.players.get(id)?.nick).filter(Boolean);
  ms.forEach((m) => {
    if (m.isAI) return;
    humanCount++;
    if (/^(나도|ㅇㅈ|맞아|ㄹㅇ|인정)/.test(m.text) || nicks.some((n) => n !== m.nick && m.text.includes(n))) replies++;
  });
  const q = humanCount ? replies / humanCount : 0;
  // ㅋㅋ와 ㅠㅠ가 한 문장에 같이 붙으면 어색하다 → 하나만
  let useKK = Math.random() < pKK;
  let useTT = Math.random() < pTT;
  if (useKK && useTT) Math.random() < 0.5 ? (useKK = false) : (useTT = false);
  const reply = chooseReply(room, group, mafia, flaw, q);
  const prof = {
    target,
    range: [lo, hi],
    useKK,
    useTT,
    pQ,
    pEx,
    pDot,
    endings,
    reply,
    own: level === 'Lv3' ? mafia.greeting || '' : '',
  };
  const replyLine = {
    none: '이번엔 누구 말에 반응하지 않고 네 이야기만 바로 말함',
    react: `이번엔 ${reply.nick} 말에 나온 구체적인 것(음식, 장소, 상황, 말투 등) 하나를 짚어 짧게 반응하고 네 이야기로 이어 감. 친구들처럼 이름을 앞에 붙여도 되고 빼도 됨`,
    tease: `이번엔 ${reply.nick} 말에 친구끼리 장난치듯 가볍게 딴지 걸거나 놀리고 네 생각을 말함(싸우듯 말지 않기)`,
  }[reply.mode];
  const lines = [
    `목표 길이: ${target}자 안팎`,
    prof.useKK ? 'ㅋㅋ/ㅎㅎ: 웃기거나 가벼운 내용이면 어울리는 자리에 넣어도 됨(슬픈 내용엔 넣지 않음)' : 'ㅋㅋ/ㅎㅎ: 이번 메시지에 넣지 않음',
    prof.useTT ? 'ㅠㅠ: 아쉽거나 속상한 내용이면 어울리는 자리에 넣어도 됨' : 'ㅠㅠ: 이번 메시지에 넣지 않음',
    endings.length ? `끝맺음: 친구들은 주로 ${endings.map((e) => `'${e}'`).join(', ')} 식으로 끝냄. 이 느낌으로 자연스럽게` : '끝맺음은 자유롭게',
    pQ < 0.15 ? '물음표 거의 안 씀' : '물음표 가끔 씀',
    pEx < 0.15 ? '느낌표 거의 안 씀' : '느낌표 가끔 씀',
    replyLine,
  ];
  if (prof.own) lines.push(`너의 평소 말투: '${prof.own}'와 비슷하게 (모둠 평균보다 우선)`);
  prof.text = lines.join('\n');
  return prof;
}

/** 마피아의 '나': 입장 인사와 앞에서 한 말. 바퀴가 바뀌어도 같은 아이처럼 이어지게 한다 */
function selfText(group, mafia) {
  const mine = group.messages.filter((m) => !m.pass && isMe(m, mafia));
  const lines = [];
  if (mafia.greeting) lines.push(`- 네 입장 인사: "${mafia.greeting}" (이 인사를 쓴 아이의 기분·관심사와 어울리게)`);
  for (const m of mine) {
    const tag = m.game < group.game ? `이전 판 ${m.round}바퀴` : `${m.round}바퀴`;
    lines.push(`- 네가 ${tag}에 한 말: "${m.text}"`);
  }
  if (mine.some((m) => m.game === group.game)) {
    lines.push('- 위에서 고른 편·말한 경험·취향과 어긋나지 않게 이어 간다. 같은 이야기를 되풀이하지 말고 새 이유나 뒷이야기를 덧붙이거나 친구 말에 반응한다. 편을 바꾸려면 누구 말 때문에 흔들렸는지 말해야 자연스럽다. 네 이야기를 이어 말할 때는 "나도"로 시작하지 않는다.');
  } else {
    lines.push('- 이번 판에서 처음 말한다. 앞 친구들과 겹치지 않는 너만의 이유나 이야기 하나로 말한다.');
  }
  return lines.join('\n');
}

function fill(tpl, vars) {
  return tpl.replace(/\{(\w+)\}/g, (_, k) => (vars[k] !== undefined ? vars[k] : `{${k}}`));
}

// 예시 속 {친구} 자리를 실제 모둠원 별명으로 바꾼다
function exampleText(ex, group, room, mafia) {
  const nicks = group.playerIds.map((id) => room.players.get(id)?.nick).filter((n) => n && (!mafia || n !== mafia.nick));
  const n = nicks.length ? pick(nicks) : '';
  return ex.replace(/\{친구\}이?\s?/g, n ? `${n} ` : '');
}

function buildPrompt(room, group, mafia, roundInfo, level, profile, directive) {
  const P = content.prompts();
  const examples = roundInfo.examples.map((e) => '- ' + exampleText(e, group, room, mafia)).join('\n');
  const system = fill(P.mafiaSystem, {
    nick: mafia.nick,
    game: group.game,
    round: group.round,
    question: roundInfo.question,
    clueDirective: directive,
    examples,
    profile: profile.text,
    self: selfText(group, mafia),
  });
  const lines = [];
  for (const id of group.playerIds) {
    const p = room.players.get(id);
    if (p && p.greeting) lines.push(`(입장 인사) ${p.nick}${p.id === mafia.id ? '(나)' : ''}: ${p.greeting}`);
  }
  for (const m of group.messages) {
    const tag = m.game < group.game ? `(이전 판 ${m.round}바퀴)` : `(${m.round}바퀴)`;
    lines.push(`${tag} ${m.nick}${isMe(m, mafia) ? '(나)' : ''}: ${m.pass ? '(패스)' : m.text}`);
  }
  lines.push('', `이제 ${group.round}바퀴 네(${mafia.nick}) 차례다. '(나)'가 붙은 줄은 네가 앞에서 쓴 말이다. 채팅 메시지 본문 한 개만 써라.`);
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
  if (n < Math.max(4, Math.floor(lo * 0.6)) || n > Math.max(Math.ceil(hi * 1.5), lo + 14)) return 'length';
  // 끝이 띄어 쓴 한 글자 어미로 깨진 문장(예: "들어 줄 어")
  if (/\s[어아요야]$/.test(text.replace(/[\s.!?~ㅋㅎㅠㅜ]+$/, ''))) return 'broken';
  if (AI_WORDS.test(text)) return 'ai-word';
  // 반말 채팅에 존댓말 끝맺음이 섞이면 바로 눈에 띈다
  if (/(요|니다)[\s.!?~ㅋㅎㅠㅜ]*$/.test(text)) return 'polite';
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
  // 지도서의 AI 한계 중 이번 판에 정한 허점을, 정해진 바퀴에만 옅게 남긴다(content/flaws.json)
  const { flaw, directive } = content.flawDirective(group.flaw, group.round, level);
  const profile = computeProfile(room, group, mafia, level, flaw);
  const backup = async (note, alert) => {
    const text = pickBackup(room, roundInfo, profile);
    const r = await processMessage(room, text);
    return { text: r.ok ? r.text : text, latencyMs: Date.now() - t0, source: 'backup', note, alert };
  };
  if (opts.forceBackup) return backup('teacher');
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
    const bad = findBanned(text);
    if (bad.length) {
      return backup(`banned:${bad.join('/')}`, `AI 문장에 금칙어가 있어 백업 메시지로 바꿨어요 (${mafia.nick})`);
    }
    const why = postCheck(text, profile, group, roundInfo);
    if (!why) {
      const r = await processMessage(room, text);
      if (r.ok) return { text: r.text, latencyMs: Date.now() - t0, source: 'ai', flaw: ai.providerName === 'mock' ? null : flaw, note: reasons.length ? `retry:${reasons.join(',')}` : undefined };
      return backup('pipeline');
    }
    reasons.push(why);
    prompt.system += `

[다시 쓰기] 방금 쓴 문장("${text.slice(0, 80)}")은 쓸 수 없다: ${retryHint(why, profile, text)} 같은 뜻이라도 새로 써라.`;
  }
  return backup(`postcheck:${reasons.join(',')}`);
}

function retryHint(why, profile, text = '') {
  const n = len(text);
  const [lo, hi] = profile.range;
  return (
    {
      length:
        n > hi
          ? `${n}자라서 너무 길다. 친구들 메시지처럼 ${profile.target}자 안팎의 짧은 한 줄로, 이야기 하나만 써라.`
          : `${n}자라서 너무 짧다. ${profile.target}자 안팎(${Math.max(4, lo)}~${hi}자)으로 맞춰라.`,
      polite: '존댓말(~요) 말고 친구들처럼 반말 채팅체로 끝내라.',
      broken: '문장 끝이 어색하게 끊겼다. 자연스럽게 끝맺어라.',
      'ai-word': 'AI·로봇·컴퓨터 같은 말은 쓰지 마라.',
      copy: '친구 말이나 예시를 10자 넘게 그대로 따오지 말고, 친구 이름을 부르며 네 말로 바꿔 써라.',
      empty: '빈 문장이다. 메시지 본문을 써라.',
    }[why] || '점검에 걸렸다.'
  );
}

module.exports = { generateMafiaMessage, computeProfile, buildPrompt, postCheck, applyProfile };
