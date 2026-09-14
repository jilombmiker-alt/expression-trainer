const test = require('node:test');
const assert = require('node:assert/strict');
const Coach = require('./ai-coach');

function result(overrides = {}) {
  return Object.assign({
    scoring: { invalid: false, total: 60, components: { connectorLogic: 62, semanticConciseness: 65 } },
    content: { missing: [{ label: '验证' }], matched: ['目标'], relationScore: 50 },
    oral: { charCount: 60, density: 80, counts: { fillers: 2, connectors: 1, repetitions: 0, selfCorrections: 0, redundancies: 0 }, groups: { fillers: [{ term: '嗯' }] }, cleanliness: { repetitions: [] }, structure: { issues: ['“然后”重复'] } },
    pauses: [], averagePause: 0, longestPause: 0
  }, overrides);
}

test('coach diagnoses at most three issues and asks before answering', () => {
  const diagnosis = Coach.diagnose(result(), {}, 0);
  assert.ok(diagnosis.issues.length <= 3);
  assert.match(diagnosis.issues[0].question, /？$/);
  assert.equal(JSON.stringify(diagnosis).includes('参考答案'), false);
});

test('coach does not claim pause data without microphone evidence', () => {
  const diagnosis = Coach.diagnose(result(), {}, 0);
  assert.match(diagnosis.boundary, /没有可用录音间隔数据/);
  assert.equal(diagnosis.issues.some((item) => item.dimension === '停顿与节奏'), false);
});

test('retry comparison is kept separate from baseline score', () => {
  const after = result({ scoring: { invalid: false, total: 78, components: {} }, content: { missing: [], matched: ['目标', '验证'], relationScore: 75 }, oral: { charCount: 55, density: 90, counts: { fillers: 0, repetitions: 0, selfCorrections: 0, redundancies: 0 }, groups: { fillers: [] }, cleanliness: { repetitions: [] }, structure: { issues: [] } } });
  const comparison = Coach.compare(result(), after);
  assert.equal(comparison.scoreDelta, 18);
  assert.equal(comparison.conceptDelta, 1);
  assert.equal(comparison.fillerDelta, 2);
  assert.equal(comparison.densityDelta, 10);
  assert.equal(comparison.relationDelta, 25);
  assert.equal(comparison.better, true);
});
