(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MicCalibration = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const TARGETS = [0.8, 1.5, 2.5];

  function validPauses(values) {
    return (Array.isArray(values) ? values : [])
      .map(Number)
      .filter((value) => Number.isFinite(value) && value >= 0.5 && value <= 20)
      .sort((a, b) => a - b);
  }

  function classifyPause(value) {
    const pause = Number(value);
    if (!Number.isFinite(pause) || pause < 0.5) return 'ignored';
    if (pause < 1) return 'short';
    if (pause <= 2) return 'natural';
    return 'long';
  }

  function toleranceFor(target) {
    return Math.max(0.45, Number(target) * 0.35);
  }

  function evaluate(pauses, targets) {
    const detected = validPauses(pauses);
    const expected = validPauses(targets || TARGETS);
    const available = detected.map((value, index) => ({ value, index, used: false }));
    const matches = expected.map((target) => {
      const candidate = available
        .filter((item) => !item.used)
        .map((item) => ({ item, error: Math.abs(item.value - target) }))
        .sort((a, b) => a.error - b.error)[0];
      const tolerance = toleranceFor(target);
      if (!candidate || candidate.error > tolerance) return { target, detected: null, error: null, matched: false, tolerance };
      candidate.item.used = true;
      return {
        target, detected: candidate.item.value, error: Math.round(candidate.error * 10) / 10,
        matched: true, tolerance: Math.round(tolerance * 10) / 10
      };
    });
    const hit = matches.filter((item) => item.matched);
    const meanError = hit.length ? Math.round(hit.reduce((sum, item) => sum + item.error, 0) / hit.length * 10) / 10 : null;
    const passed = hit.length >= 2 && meanError !== null && meanError <= 0.7;
    return {
      expected, detected, matches, matchedCount: hit.length, meanError, passed,
      status: passed ? 'passed' : 'retry',
      message: passed
        ? `检测到 ${detected.length} 次有效停顿，其中 ${hit.length} 次接近目标，停顿数据可以用于本轮分析。`
        : detected.length
          ? `检测到 ${detected.length} 次有效停顿，但只有 ${hit.length} 次接近目标。请在更安静的环境重试。`
          : '没有获得可用的时间戳停顿，本次校准不能通过。'
    };
  }

  function permissionState(options) {
    const value = options || {};
    if (!value.secureContext) return { status: 'unsupported', label: '环境不安全', action: '请使用 HTTPS 或本机地址打开页面。' };
    if (!value.mediaDevices) return { status: 'unsupported', label: '浏览器不支持录音', action: '请改用最新版 Chrome、Edge 或 Safari。' };
    if (value.permission === 'denied') return { status: 'denied', label: '麦克风已被拒绝', action: '点击地址栏左侧的网站设置，将麦克风改为允许，再点击重新检测。' };
    if (value.permission === 'granted') return { status: 'granted', label: '麦克风已允许', action: '可以开始校准。' };
    return { status: 'prompt', label: '等待麦克风授权', action: '开始校准时，浏览器会询问是否允许使用麦克风。' };
  }

  return { TARGETS, validPauses, classifyPause, toleranceFor, evaluate, permissionState };
});

