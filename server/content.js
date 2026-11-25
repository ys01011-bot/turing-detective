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

// 같은 clue 유형의 기본값(직접 입력 질문용)
function defaultRoundForClue(clue) {
  for (const s of topicSets().sets) {
    const r = s.rounds.find((x) => x.clue === clue);
    if (r) return r;
  }
  return topicSets().sets[0].rounds[0];
}

/**
 * 판(game)·바퀴(round)에 해당하는 바퀴 정보.
 * gameCfg = { setId, custom: [{question, clue}] | null }
 */
function getRound(gameCfg, round) {
  const set = getSet(gameCfg.setId);
  const base = set.rounds[Math.min(round - 1, set.rounds.length - 1)];
  const custom = gameCfg.custom && gameCfg.custom[round - 1];
  if (custom && custom.question) {
    const clue = custom.clue || base.clue;
    const d = clue === base.clue ? base : defaultRoundForClue(clue);
    return { ...d, question: custom.question, clue };
  }
  return base;
}

module.exports = { topicSets, spelling, banned, prompts, classQuestions, getSet, getRound };
