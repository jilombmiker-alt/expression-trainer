const test = require('node:test');
const assert = require('node:assert/strict');
const analyzer = require('./analyzer.js');

test('distinguishes fillers, connectors, hedges and habits', () => {
  const result = analyzer.analyze('嗯，我觉得这个方案可能可以。第一点，先测试；第二点，再复盘。总的来说，就是先做验证。');
  assert.ok(result.counts.fillers >= 2);
  assert.ok(result.counts.hedges >= 2);
  assert.ok(result.counts.connectors >= 2);
  assert.ok(result.structure.nodes.some((node) => node.key === 'point1'));
  assert.ok(result.structure.nodes.some((node) => node.key === 'point2'));
});

test('detects missing numbered point', () => {
  const structure = analyzer.detectStructure('第二点是验证。第三点是复盘。最后给出行动。');
  assert.ok(structure.issues.some((issue) => issue.includes('第一点')));
});

test('faithful cleanup removes fillers without inventing content', () => {
  const cleaned = analyzer.createFaithfulCleanup('嗯，那个，我的结论是先测试，然后然后再决定。就是我觉得可以推进');
  assert.equal(cleaned.includes('嗯'), false);
  assert.equal(cleaned.includes('那个'), false);
  assert.equal(cleaned.includes('就是我觉得'), false);
  assert.ok(cleaned.includes('我的结论是先测试'));
  assert.ok(cleaned.endsWith('。'));
});

test('retell coverage reports matched and missing keywords', () => {
  const result = analyzer.keywordCoverage('项目需要先验证再复盘', '我们先做项目验证', ['项目', '验证', '复盘']);
  assert.deepEqual(result.matched, ['项目', '验证']);
  assert.deepEqual(result.missing, ['复盘']);
  assert.equal(result.score, 67);
});

test('detects repetitions, self corrections and redundant phrases separately', () => {
  const result = analyzer.analyze('我们需要需要先验证，不对，我的意思是目前现阶段先做小范围验证。');
  assert.ok(result.counts.repetitions >= 1);
  assert.ok(result.counts.selfCorrections >= 1);
  assert.ok(result.counts.redundancies >= 1);
  assert.ok(result.cleanliness.informationDensity < 100);
});
