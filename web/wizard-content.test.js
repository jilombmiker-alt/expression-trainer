const test = require('node:test');
const assert = require('node:assert/strict');
const { SETS, countChars, evaluate } = require('./wizard-content.js');

test('provides twelve categories with at least six two-round packs each', () => {
  assert.equal(new Set(SETS.map((set) => set.category)).size, 12);
  assert.ok(SETS.length >= 72);
  const counts = SETS.reduce((result, set) => ({ ...result, [set.category]: (result[set.category] || 0) + 1 }), {});
  Object.values(counts).forEach((count) => assert.ok(count >= 6));
  SETS.forEach((set) => {
    assert.equal(set.rounds.length, 2);
    assert.ok(set.categoryLabel && set.packLabel);
    set.rounds.forEach((round) => assert.ok(countChars(round.text) >= 100 && countChars(round.text) <= 220, `${set.label}: ${countChars(round.text)}`));
  });
});

test('semantic concept groups accept alternative terms', () => {
  const exercise = SETS.find((set) => set.id === 'work').rounds[0];
  const result = evaluate(exercise, '要先比较原定计划和最终情况，找到差距与风险，再明确负责人和验收时间。');
  assert.ok(result.score >= 75);
  assert.ok(result.matched.length >= 3);
});
