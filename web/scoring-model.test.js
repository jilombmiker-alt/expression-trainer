const test = require('node:test');
const assert = require('node:assert/strict');
const Scoring = require('./scoring-model.js');

function sampleResult() {
  return {
    oral: {
      charCount: 100,
      counts: { fillers: 1, hedges: 0, connectors: 3 },
      structure: { score: 88, issues: [] },
      fluencyScore: 92
    },
    content: { score: 75, matched: [{ label: '目标' }, { label: '风险' }, { label: '行动' }], missing: [{ label: '资源' }] },
    pauses: [0.8, 1.1, 1.4],
    averagePause: 1.1,
    longestPause: 1.4,
    pace: 205,
    elapsed: 34,
    transcript: '我的核心观点是先明确目标，再根据风险与资源决定下一步行动。'
  };
}

const exercise = { text: '这是用于测试长度比例的原始文章。'.repeat(10) };

test('confirmed first-round weights total 100', () => {
  assert.equal(Scoring.totalWeight(Scoring.DEFAULT_WEIGHTS.first), 100);
  assert.equal(Scoring.DEFAULT_WEIGHTS.first.oralControl, 25);
  assert.equal(Scoring.DEFAULT_WEIGHTS.first.pauseRhythm, 20);
  assert.equal(Scoring.DEFAULT_WEIGHTS.first.keyCoverage, 20);
});

test('confirmed second-round weights prioritize central meaning', () => {
  assert.equal(Scoring.totalWeight(Scoring.DEFAULT_WEIGHTS.second), 100);
  assert.equal(Scoring.DEFAULT_WEIGHTS.second.centralAccuracy, 35);
  assert.equal(Scoring.DEFAULT_WEIGHTS.second.keyCoverage, 15);
  assert.equal(Scoring.DEFAULT_WEIGHTS.second.compressionTime, 5);
});

test('missing microphone pause data is marked provisional, not invented', () => {
  const result = sampleResult();
  result.pauses = [];
  result.averagePause = 0;
  result.longestPause = 0;
  const scored = Scoring.calculate('first', result, exercise, Scoring.DEFAULT_WEIGHTS.first);
  assert.equal(scored.components.pauseRhythm, null);
  assert.equal(scored.provisional, true);
  assert.ok(Number.isFinite(scored.total));
});

test('one filler in one hundred meaningful characters can still score 90+', () => {
  const scored = Scoring.componentScores('first', sampleResult(), exercise);
  assert.ok(scored.oralControl >= 90);
});

test('diagnostic recommends a focused valid profile', () => {
  const result = sampleResult();
  result.oral.counts.fillers = 12;
  const recommendation = Scoring.recommendFirst(result, exercise);
  assert.equal(recommendation.presetKey, 'oral');
  assert.equal(Scoring.totalWeight(recommendation.weights), 100);
});

test('few-second answer is rejected before weights are applied', () => {
  const result = sampleResult();
  result.elapsed = 4;
  result.pace = 900;
  const scored = Scoring.calculate('first', result, exercise, Scoring.DEFAULT_WEIGHTS.first);
  assert.equal(scored.total, 0);
  assert.equal(scored.invalid, true);
  assert.ok(scored.gate.reasons.some((reason) => reason.includes('少于15秒')));
  assert.ok(Object.values(scored.components).every((score) => score === 0));
});

test('answer missing all knowledge points receives zero even if delivery looks fluent', () => {
  const result = sampleResult();
  result.content = { score: 0, matched: [], missing: [{}, {}, {}, {}] };
  result.transcript = '我的观点是今天天气不错，所以我准备出去散步并且早点回来。';
  const scored = Scoring.calculate('first', result, exercise, Scoring.DEFAULT_WEIGHTS.first);
  assert.equal(scored.total, 0);
  assert.equal(scored.invalid, true);
  assert.ok(scored.gate.reasons.includes('四个核心知识点均未覆盖'));
});

test('keyword pile without a complete viewpoint receives zero', () => {
  const result = sampleResult();
  result.transcript = '目标风险资源行动目标风险资源行动目标风险资源行动';
  const scored = Scoring.calculate('first', result, exercise, Scoring.DEFAULT_WEIGHTS.first);
  assert.equal(scored.total, 0);
  assert.ok(scored.gate.reasons.includes('没有形成可判断的完整观点'));
});
