// content/ 폴더의 수업 내용 파일을 읽는다. 파일을 고치면 서버를 다시 켜지 않아도 다음 읽기에 반영된다.
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'content');
const cache = {};

function load(name) {
  const file = path.join(DIR, name);
  const mtime = fs.statSync(file).mtimeMs;
  const c = cache[name];
  if (c && c.mtime === mtime) return c.data;
  let data;
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    // 수업 중 파일을 고치다 틀려도 직전 내용으로 계속 진행
    console.error(`[content] ${name} 을(를) 읽지 못했어요: ${e.message}`);
    if (c) return c.data;
    throw e;
  }
  cache[name] = { mtime, data };
  return data;
}

const topicSets = () => load('topic-sets.json');
const spelling = () => load('spelling-rules.json');
const banned = () => load('banned-words.json');
const prompts = () => load('prompts.json');
const classQuestions = () => load('class-questions.json');
const flaws = () => load('flaws.json');

function getSet(id) {
  const all = topicSets().sets;
  return all.find((s) => s.id === id) || all[0];
}

/**
 * 판(game)·바퀴(round)에 해당하는 바퀴 정보. 한 판은 질문 하나로 진행하고
 * 바퀴마다 같은 질문을 이어서 이야기한다(바퀴별로 다른 것은 AI 단서·지시·예시·백업·안내).
 * gameCfg = { setId, custom: [{question}] | null }  ← 교사가 직접 입력한 이 판의 질문
 */
function getRound(gameCfg, round) {
  const set = getSet(gameCfg.setId);
  const base = set.rounds[Math.min(round - 1, set.rounds.length - 1)];
  const customQ = gameCfg.custom && (gameCfg.custom.find((c) => c && c.question) || {}).question;
  return { ...base, question: customQ || set.question || base.question, guide: round >= 2 ? base.guide || '' : '' };
}

/**
 * 한 판에서 모둠의 AI가 남길 허점을 정한다(지도서의 AI 한계, content/flaws.json).
 * - 주제 세트의 후보 중 이 모둠이 앞 판에서 쓰지 않은 것을 무작위로 고른다.
 * - Lv1(연습)은 모든 바퀴에, Lv2·Lv3은 무작위 한 바퀴에만 남긴다.
 * @returns {{id:string, laps:number[]}}
 */
function planFlaw(gameCfg, level, rounds, used = []) {
  const set = getSet(gameCfg.setId);
  const all = Object.keys(flaws().flaws);
  let pool = (set.flaws || all).filter((k) => all.includes(k));
  if (!pool.length) pool = all;
  const fresh = pool.filter((k) => !used.includes(k));
  const cand = fresh.length ? fresh : pool;
  const id = cand[Math.floor(Math.random() * cand.length)];
  const n = Math.max(1, rounds);
  const laps = level === 'Lv1' ? Array.from({ length: n }, (_, i) => i + 1) : [1 + Math.floor(Math.random() * n)];
  return { id, laps };
}

/** 이번 바퀴의 허점 지시. 허점 바퀴가 아니면 natural 지시와 flaw=null */
function flawDirective(plan, round, level) {
  const F = flaws();
  const f = plan && plan.laps.includes(round) ? F.flaws[plan.id] : null;
  if (!f) return { flaw: null, directive: F.natural };
  return { flaw: plan.id, directive: f.directive[level] || f.directive.Lv2 };
}

module.exports = { topicSets, spelling, banned, prompts, classQuestions, flaws, getSet, getRound, planFlaw, flawDirective };
