(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AnswerTiming = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  function create(now = Date.now()) { return { startedAt: now, speechStartedAt: null, speechMs: 0, submittedAt: null }; }
  function startSpeech(value, now = Date.now()) {
    if (value.speechStartedAt === null && value.submittedAt === null) value.speechStartedAt = now;
  }
  function stopSpeech(value, now = Date.now()) {
    if (!value || value.speechStartedAt === null) return;
    value.speechMs += Math.max(0, now - value.speechStartedAt); value.speechStartedAt = null;
  }
  function freeze(value, now = Date.now()) {
    if (value.submittedAt === null) { stopSpeech(value, now); value.submittedAt = now; }
    const wallMs = Math.max(0, value.submittedAt - value.startedAt);
    return { wallMs, speechMs: value.speechMs, elapsedSeconds: Math.round((value.speechMs || wallMs) / 1000), source: value.speechMs ? 'client-recording' : 'client-text' };
  }
  return { create, startSpeech, stopSpeech, freeze };
});
