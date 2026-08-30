const test = require('node:test');
const assert = require('node:assert/strict');
const { ARTICLES, evaluateSummary } = require('./training-content.js');

test('provides one substantial article for each requested scene', () => {
  assert.deepEqual(new Set(ARTICLES.map((item) => item.scene)), new Set(['work', 'interview', 'creator', 'daily']));
  ARTICLES.forEach((article) => assert.ok(article.text.length >= 650, `${article.title} is too short`));
});

test('summary evaluation reports matched and missing keywords', () => {
  const article = ARTICLES[0];
  const result = evaluateSummary(article, '复盘要比较目标和结果，找到偏差与原因，最后形成行动。');
  assert.equal(result.matched.length, 5);
  assert.equal(result.missing.length, 0);
  assert.ok(result.score >= 65);
});
