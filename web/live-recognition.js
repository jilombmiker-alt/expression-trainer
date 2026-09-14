(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.LiveRecognition = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const FATAL_ERRORS = new Set(['not-allowed', 'service-not-allowed', 'audio-capture', 'language-not-supported']);

  function classifyError(value) {
    const code = String(value || 'unknown');
    if (FATAL_ERRORS.has(code)) return { code, fatal: true };
    return { code, fatal: false };
  }

  function decideEnd(options) {
    const intentActive = options?.intentActive === true;
    const stopReason = String(options?.stopReason || '');
    const restartCount = Math.max(0, Number(options?.restartCount || 0));
    const maxRestarts = Math.max(1, Number(options?.maxRestarts || 5));
    if (stopReason === 'error') return { action: 'stop', reason: 'error' };
    if (!intentActive || stopReason === 'manual') return { action: 'stop', reason: 'manual' };
    if (restartCount >= maxRestarts) return { action: 'stop', reason: 'exhausted' };
    return {
      action: 'restart',
      reason: 'unexpected-end',
      nextRestartCount: restartCount + 1,
      delayMs: Math.min(1200, 250 + restartCount * 200),
    };
  }

  return { classifyError, decideEnd };
});
