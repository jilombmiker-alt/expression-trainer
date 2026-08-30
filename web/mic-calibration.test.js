const test = require('node:test');
const assert = require('node:assert/strict');
const Calibration = require('./mic-calibration');

test('calibration passes when at least two real pauses match expected durations', () => {
  const result = Calibration.evaluate([0.9, 1.6, 2.4]);
  assert.equal(result.status, 'passed');
  assert.equal(result.matchedCount, 3);
  assert.equal(result.meanError, 0.1);
});

test('calibration fails closed without timestamp evidence', () => {
  const result = Calibration.evaluate([]);
  assert.equal(result.status, 'retry');
  assert.equal(result.detected.length, 0);
  assert.match(result.message, /不能通过/);
});

test('calibration does not reuse one detected pause for multiple targets', () => {
  const result = Calibration.evaluate([1.4]);
  assert.equal(result.matchedCount, 1);
  assert.equal(result.status, 'retry');
});

test('permission denial returns a concrete recovery path', () => {
  const result = Calibration.permissionState({ secureContext: true, mediaDevices: true, permission: 'denied' });
  assert.equal(result.status, 'denied');
  assert.match(result.action, /地址栏/);
});

test('insecure context fails before asking for microphone permission', () => {
  const result = Calibration.permissionState({ secureContext: false, mediaDevices: true, permission: 'prompt' });
  assert.equal(result.status, 'unsupported');
  assert.match(result.action, /HTTPS/);
});

