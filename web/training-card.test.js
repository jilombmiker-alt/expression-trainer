const test = require('node:test');
const assert = require('node:assert/strict');
const TrainingCard = require('./training-card.js');

function card() {
  const round = {
    title: '示例',
    text: '这是一段用于知识训练卡校验的示例内容，它需要包含足够多的信息，才能让用户阅读、理解并在隐藏原文之后重新表达其中的中心思想和关键关系。',
    central: '训练卡需要支持理解与重新表达。',
    concepts: [
      { label: '阅读', terms: ['阅读'] },
      { label: '理解', terms: ['理解'] },
      { label: '表达', terms: ['表达'] }
    ]
  };
  return { title: '我的知识库', rounds: [round, { ...round, title: '第二篇' }] };
}

test('normalizes a two-round knowledge training card', () => {
  const normalized = TrainingCard.normalize(card());
  assert.equal(normalized.id, 'knowledge');
  assert.equal(normalized.rounds.length, 2);
  assert.equal(normalized.rounds[0].concepts.length, 3);
});

test('rejects incomplete knowledge cards', () => {
  assert.throws(() => TrainingCard.normalize({ title: '缺失轮次' }), /两轮/);
});

test('treats imported content as text rather than markup', () => {
  const unsafe = card();
  unsafe.title = '<img src=x onerror=alert(1)>知识';
  assert.equal(TrainingCard.normalize(unsafe).label.includes('<'), false);
});

test('preserves source references and challenge metadata', () => {
  const source = card(); source.sourceMode = 'supplied-file'; source.sourceRefs = ['课程笔记.md'];
  source.challenge = { prepMinutes: 15, answerMinutes: 10 };
  const normalized = TrainingCard.normalize(source);
  assert.deepEqual(normalized.sourceRefs, ['课程笔记.md']);
  assert.equal(normalized.challenge.prepMinutes, 15);
});
