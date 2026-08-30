const test = require('node:test');
const assert = require('node:assert/strict');
const Progress = require('./progress-model');

test('seven level boundaries are stable', () => {
  assert.equal(Progress.levelFor(39).id, 1);
  assert.equal(Progress.levelFor(40).id, 2);
  assert.equal(Progress.levelFor(93).id, 7);
});

test('ability index uses fixed 50/50 rounds', () => {
  assert.equal(Progress.abilityIndex(80, 60), 70);
  assert.equal(Progress.abilityIndex(null, 60), null);
});

test('invalid answer breaks streak but does not lower earned level', () => {
  const data = Progress.emptyStore();
  data.records = [
    { valid: true, score: 88, dimensions: {} },
    { valid: true, score: 90, dimensions: {} },
    { valid: false, score: 0, dimensions: null }
  ];
  const view = Progress.profile(data);
  assert.equal(view.earned.id, 6);
  assert.equal(view.historicalHigh, 90);
  assert.equal(view.streak, 0);
  assert.equal(view.current, 89);
});

test('plan ratios must total one hundred', () => {
  const base = Progress.recommendPlan(Progress.emptyStore());
  assert.equal(Progress.validPlan(base), true);
  base.ratios.primary = 55;
  assert.equal(Progress.validPlan(base), false);
  assert.throws(() => Progress.upsertPlan(Progress.emptyStore(), base), /100%/);
});
