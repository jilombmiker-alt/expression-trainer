const test = require('node:test');
const assert = require('node:assert/strict');
const LiveRecognition = require('./live-recognition');

test('unexpected browser recognition end restarts while the user is still recording', () => {
  assert.deepEqual(LiveRecognition.decideEnd({ intentActive: true, restartCount: 0 }), {
    action: 'restart', reason: 'unexpected-end', nextRestartCount: 1, delayMs: 250,
  });
});

test('manual stop never restarts recognition', () => {
  assert.equal(LiveRecognition.decideEnd({ intentActive: false, stopReason: 'manual' }).action, 'stop');
});

test('fatal recognition errors never restart', () => {
  assert.equal(LiveRecognition.decideEnd({ intentActive: true, stopReason: 'error' }).reason, 'error');
  assert.equal(LiveRecognition.classifyError('not-allowed').fatal, true);
});

test('temporary no-speech errors remain retryable', () => {
  assert.equal(LiveRecognition.classifyError('no-speech').fatal, false);
});

test('repeated unexpected endings stop after a bounded number of retries', () => {
  assert.equal(LiveRecognition.decideEnd({ intentActive: true, restartCount: 5, maxRestarts: 5 }).reason, 'exhausted');
});
