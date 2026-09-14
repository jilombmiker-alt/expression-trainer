const test = require('node:test');
const assert = require('node:assert/strict');
const Timing = require('./answer-timing.js');
test('AI wait and duplicate submit never increase answer duration', () => {
  const value = Timing.create(1000);
  assert.equal(Timing.freeze(value, 21000).elapsedSeconds, 20);
  assert.equal(Timing.freeze(value, 61000).elapsedSeconds, 20);
});
test('speech time excludes permission wait, transcription, editing and multiple recording gaps', () => {
  const value = Timing.create(0);
  Timing.startSpeech(value, 5000); Timing.stopSpeech(value, 15000);
  Timing.startSpeech(value, 40000); Timing.stopSpeech(value, 55000);
  assert.deepEqual(Timing.freeze(value, 90000), { wallMs: 90000, speechMs: 25000, elapsedSeconds: 25, source: 'client-recording' });
});
