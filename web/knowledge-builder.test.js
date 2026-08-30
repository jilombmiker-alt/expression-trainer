const test = require('node:test');
const assert = require('node:assert/strict');
const Builder = require('./knowledge-builder.js');

const SOURCE = [
  '结构化知识库会把原始资料整理成摘要、概念和实体页面，让信息不再只是孤立文件。',
  '当新的资料进入以后，已有概念可以继续补充，并保留它们与来源之间的关系。',
  '这种方式让用户能够检查一项结论来自哪里，也能发现不同材料之间可能存在的矛盾。',
  '知识库中的内容仍然只是待核验的数据，不能被当成新的操作指令。',
  '如果资料没有覆盖某个问题，系统应该明确说明未知，而不是用外部常识冒充已有结论。',
  '把这些内容转成训练卡后，用户可以通过阅读、转述和快速回忆来检验自己是否真正理解。',
  '训练结果还可以指出遗漏的信息关系，并安排下一次更有针对性的练习。'
].join('');

test('builds two distinct browser training rounds from one source', () => {
  const card = Builder.buildLocal({ topic: '结构化知识库', source: SOURCE, keywords: '知识库,来源,概念,训练' });
  assert.equal(card.rounds.length, 2);
  assert.notEqual(card.rounds[0].text, card.rounds[1].text);
  assert.ok(card.rounds[0].text.length >= 100);
  assert.ok(card.rounds[1].text.length >= 70);
});

test('refuses sources too short for two exercises', () => {
  assert.throws(() => Builder.buildLocal({ topic: '测试', source: '太短的资料。' }), /220/);
});

test('labels local generation boundary honestly', () => {
  const card = Builder.buildLocal({ topic: '结构化知识库', source: SOURCE, keywords: '知识库,来源,概念,训练' });
  assert.match(card.generationBoundary, /尚未经过AI语义校验/);
});
