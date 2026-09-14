const test = require('node:test');
const assert = require('node:assert/strict');
const Speech = require('./speech-adapter');

test('preserves measured no-gap evidence separately from missing recording data', () => {
  const pauseMeasurement = { method: 'pcm-energy-v1', available: true, intervals: [] };
  assert.deepEqual(Speech.normalizeResult({text:'测试',pauseMeasurement}).pauseMeasurement,pauseMeasurement);
  assert.equal(Speech.normalizeResult({text:'测试'}).pauseMeasurement,null);
});

test('normalizes timestamp pause evidence and requires unknown confidence confirmation', () => {
  const result = Speech.normalizeResult({ text: '测试', pauses: [.2, .8, 2.4, 30], confidence: null, engine: 'funasr' });
  assert.deepEqual(result.pauses, [.8, 2.4]);
  assert.equal(result.needsConfirmation, true);
});

test('health fails closed when service is unavailable', async () => {
  const result = await Speech.health(async () => { throw new Error('offline'); });
  assert.equal(result.available, false);
  assert.match(result.reason, /未启动/);
});

test('health exposes chunked task capability explicitly', async () => {
  const result = await Speech.health(async () => ({ ok: true, json: async () => ({ available: true, capabilities: ['chunked_tasks'] }) }));
  assert.equal(result.chunkedTasks, true);
});

test('audio task creation sends only controlled metadata', async () => {
  let request;
  const result = await Speech.createAudioTask('audio/webm', ['中心观点'], async (url, options) => {
    request = { url, options };
    return { ok: true, json: async () => ({ id: 'task-1', status: 'uploading' }) };
  });
  assert.equal(result.status, 'uploading');
  assert.equal(request.url, '/api/audio/tasks');
  assert.deepEqual(JSON.parse(request.options.body).hotwords, ['中心观点']);
});

test('reads the unified backend error contract', () => {
  assert.equal(Speech.errorMessage({ error: { code: 'invalid_audio', message: '录音格式不正确。', retryable: false } }, '失败'), '录音格式不正确。');
  assert.equal(Speech.errorMessage({ error: 'legacy_error', reason: '旧版提示' }, '失败'), '旧版提示');
});

test('audio polling reports a disconnect and recovers without creating a new task', async () => {
  let calls = 0; const updates = [];
  const fetcher = async () => {
    calls += 1;
    if (calls === 1) throw new Error('offline');
    return { ok: true, json: async () => ({ status: 'completed', result: { text: '恢复后的转录', confidence: .9, pauses: [] } }) };
  };
  const result = await Speech.waitForAudioTask('task-1', (value) => updates.push(value), fetcher, { intervalMs: 1, timeoutMs: 1000 });
  assert.equal(result.text, '恢复后的转录');
  assert.equal(updates[0].frontendState, 'disconnected');
  assert.equal(calls, 2);
});
