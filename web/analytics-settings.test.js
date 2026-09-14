const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
function validator() {
  const context = { window: {} };
  vm.runInNewContext(fs.readFileSync(require.resolve('./analytics-settings.js'), 'utf8'), context);
  return context.window.ExpressionAnalytics.validate;
}
const empty = () => ({ schemaVersion: 1, scope: 'personal', days: 7, training: { started: 0, completed: 0, completionRate: null }, assessment: { saved: 0, invalid: 0, baselineAverage: null, baselineSamples: 0 } });
test('analytics preserves unknown scores and strips unexpected fields', () => {
  const result = validator()({ ...empty(), transcript: 'must not render' });
  assert.equal(result.assessment.baselineAverage, null);
  assert.equal(result.transcript, undefined);
});
test('analytics rejects wrong scope, broken counts and malformed response', () => {
  const validate = validator();
  for (const bad of [null, {}, { ...empty(), scope: 'operator' }, { ...empty(), days: 0 }, { ...empty(), training: { started: 0, completed: 1, completionRate: 100 } }, { ...empty(), assessment: { saved: 0, invalid: 0, baselineAverage: NaN, baselineSamples: 0 } }]) assert.throws(() => validate(bad));
});
test('operator analytics requires an explicit matching scope', () => {
  const validate = validator();
  assert.equal(validate({ ...empty(), scope: 'operator' }, 'operator').scope, 'operator');
  assert.throws(() => validate(empty(), 'operator'));
});
