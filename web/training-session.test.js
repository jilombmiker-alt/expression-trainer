const test = require('node:test');
const assert = require('node:assert/strict');
const Session = require('./training-session');

test('all nine reading durations survive draft reload', () => {
  for (const readingSeconds of [30, 60, 90, 120, 150, 180, 210, 240, 300]) {
    assert.equal(Session.normalize(Session.snapshot({ step: 1, readingSeconds })).readingSeconds, readingSeconds);
  }
  assert.equal(Session.snapshot({step: 1, readingSeconds: 270}).readingSeconds, 180);
});

function memory(initial) {
  const values = new Map(Object.entries(initial || {}));
  return { getItem: (key) => values.get(key) || null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) };
}

test('draft keeps low confidence confirmation unresolved', () => {
  const store = memory();
  Session.save({ step: 2, maxStep: 2, scene: 'work', readingSeconds: 180, transcripts: ['测试', ''], asrMeta: [{ text: '测试', confidence: null, needsConfirmation: true }, null], transcriptConfirmed: [false, false], results: [null, null], weights: {}, weightPreset: {} }, store);
  const loaded = Session.load(store).draft;
  assert.equal(loaded.asrMeta[0].needsConfirmation, true);
  assert.equal(loaded.transcriptConfirmed[0], false);
});

test('completed or selection screens are not stored as active drafts', () => {
  assert.equal(Session.snapshot({ step: 0 }), null);
  assert.equal(Session.snapshot({ step: 6 }), null);
});

test('corrupt draft fails without throwing', () => {
  const result = Session.load(memory({ [Session.STORAGE_KEY]: '{broken' }));
  assert.equal(result.draft, null);
  assert.match(result.error, /损坏/);
});

test('audio task identity survives refresh without microphone state', () => {
  const id = '12345678-1234-1234-1234-123456789abc';
  const result = Session.snapshot({ step: 2, scene: 'work', transcripts: ['', ''], asrMeta: [null, null], transcriptConfirmed: [false, false], results: [null, null], audioTaskId: id, audioTaskRound: 0 });
  assert.equal(result.audioTaskId, id);
  assert.equal(result.audioTaskRound, 0);
  assert.equal('recording' in result, false);
});
