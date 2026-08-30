const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function loadFoundation() {
  const context = {
    window: null,
    fetch,
    AbortController,
    Headers,
    DOMException,
    Error,
    Object,
    String,
    Boolean,
    Number,
    Math,
    setTimeout,
    clearTimeout,
    sessionStorage: {
      value: '',
      getItem(key) { return key === 'expression.modelConnection.v1' ? this.value : null; },
      setItem(_key, value) { this.value = value; },
      removeItem() { this.value = ''; }
    }
  };
  context.window = context;
  vm.runInNewContext(fs.readFileSync(require.resolve('./frontend-foundation.js'), 'utf8'), context);
  return context.ExpressionFrontend;
}

test('maps backend audio states to safe frontend states', () => {
  const api = loadFoundation();
  assert.equal(api.mapTaskStatus('uploading'), 'submitting');
  assert.equal(api.mapTaskStatus('transcribing'), 'running');
  assert.equal(api.mapTaskStatus('completed', true), 'waiting_user');
  assert.equal(api.mapTaskStatus('new-provider-state'), 'stale');
});

test('normalizes the unified error contract without exposing unknown fields', () => {
  const api = loadFoundation();
  const error = api.normalizeError({ error: { code: 'invalid_source', message: '资料不足。', retryable: false, fieldErrors: { source: '至少 220 字' }, secret: 'hidden' } });
  assert.equal(error.code, 'invalid_source');
  assert.equal(error.userMessage, '资料不足。');
  assert.deepEqual({ ...error.fieldErrors }, { source: '至少 220 字' });
  assert.equal(error.secret, undefined);
});

test('polling backs off and slows down on hidden pages', () => {
  const api = loadFoundation();
  assert.equal(api.pollDelay(0, false), 700);
  assert.equal(api.pollDelay(3, false), 5600);
  assert.equal(api.pollDelay(0, true), 5000);
  assert.equal(api.pollDelay(12, false), 8000);
});

test('single-flight guard prevents duplicate expensive submissions', async () => {
  const api = loadFoundation();
  let calls = 0;
  const operation = async () => { calls += 1; await new Promise((resolve) => setTimeout(resolve, 5)); return 'ready'; };
  const [first, second] = await Promise.all([api.runOnce('knowledge', operation), api.runOnce('knowledge', operation)]);
  assert.equal(first, 'ready');
  assert.equal(second, 'ready');
  assert.equal(calls, 1);
});

test('semantic requests carry only the opaque BYOK connection id', async () => {
  let capturedHeaders = null;
  const fetcher = async (_path, init) => {
    capturedHeaders = init.headers;
    return { ok: true, json: async () => ({ ok: true }) };
  };
  // The VM owns the storage; expose a setter through a request-free helper load.
  const context = {
    window: null, fetch, AbortController, Headers, DOMException, Error, Object, String, Boolean, Number, Math, setTimeout, clearTimeout,
    sessionStorage: { getItem: () => 'opaque-connection-id' }
  };
  context.window = context;
  vm.runInNewContext(fs.readFileSync(require.resolve('./frontend-foundation.js'), 'utf8'), context);
  await context.ExpressionFrontend.requestJson('/api/semantic/evaluate', {}, { fetcher });
  assert.equal(capturedHeaders.get('X-Model-Connection'), 'opaque-connection-id');
  assert.equal(capturedHeaders.get('Authorization'), null);
});
