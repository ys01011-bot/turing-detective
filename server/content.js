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

module.exports = { topicSets, spelling, banned, prompts, classQuestions, getSet, getRound };
