const test = require('node:test');
const assert = require('node:assert/strict');
const Semantic = require('./semantic-evaluator');

const exercise = {
  text: '因为风险增加，所以团队需要先验证，再决定是否扩大。',
  central: '团队应先验证风险，再决定扩大。',
  concepts: [
    { label: '风险', terms: ['风险'] },
    { label: '先验证', terms: ['验证', '测试'] },
    { label: '再决定', terms: ['决定', '选择'] },
    { label: '扩大', terms: ['扩大', '推广'] }
  ]
};

test('local hybrid combines concept coverage and relation structure', () => {
  const result = Semantic.evaluate(exercise, '因为风险还不清楚，所以先测试，再决定要不要推广。');
  assert.equal(result.matched.length, 4);
  assert.ok(result.relationScore > 0);
  assert.equal(result.method, 'local-hybrid');
  assert.equal(result.provisional, true);
});

test('validated model evidence can match paraphrase and flag conflict', () => {
  const model = { concepts: exercise.concepts.map((item, index) => ({ label: item.label, status: index === 3 ? 'conflict' : 'matched', evidence: index === 3 ? '直接全面铺开' : '已有对应证据', confidence: .9 })) };
  const result = Semantic.evaluate(exercise, '先做小范围实验，然后判断，但现在直接全面铺开。', model);
  assert.equal(result.method, 'model-hybrid');
  assert.equal(result.conflicts.length, 1);
  assert.equal(result.details[0].matchType, 'model');
});
