(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TrainingSession = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const STORAGE_KEY = 'expression.trainingDraft.v1';
  const SCHEMA_VERSION = 1;

  function text(value, maximum) { return String(value || '').slice(0, maximum); }
  function array(value, length, map) {
    const source = Array.isArray(value) ? value.slice(0, length) : [];
    while (source.length < length) source.push(null);
    return source.map(map);
  }
  function jsonSafe(value, maximum) {
    try {
      const raw = JSON.stringify(value);
      return raw.length <= maximum ? JSON.parse(raw) : null;
    } catch (_) { return null; }
  }
  function validTaskId(value) { return /^[0-9a-f-]{36}$/.test(String(value || '')) ? String(value) : null; }

  function snapshot(state) {
    if (!state || !Number.isInteger(state.step) || state.step < 1 || state.step > 5) return null;
    const asrMeta = array(state.asrMeta, 2, (item) => item && typeof item === 'object' ? {
      text: text(item.text, 5000), engine: text(item.engine, 30), confidence: Number.isFinite(item.confidence) ? item.confidence : null,
      pauses: Array.isArray(item.pauses) ? item.pauses.map(Number).filter(Number.isFinite).slice(0, 500) : [],
      durationMs: Number(item.durationMs || 0), needsConfirmation: Boolean(item.needsConfirmation), warning: text(item.warning, 240),
      segments: Array.isArray(item.segments) ? item.segments.slice(0, 2000) : []
    } : null);
    return {
      schemaVersion: SCHEMA_VERSION, updatedAt: new Date().toISOString(),
      step: state.step, maxStep: Math.max(state.step, Number(state.maxStep || 0)),
      scene: text(state.scene, 80), readingSeconds: [120, 180, 240, 300].includes(Number(state.readingSeconds)) ? Number(state.readingSeconds) : 180,
      transcripts: array(state.transcripts, 2, (item) => text(item, 5000)),
      asrMeta, transcriptConfirmed: array(state.transcriptConfirmed, 2, Boolean),
      results: array(state.results, 2, (item) => jsonSafe(item, 150000)),
      weights: jsonSafe(state.weights, 5000), weightPreset: jsonSafe(state.weightPreset, 1000),
      importedSet: jsonSafe(state.importedSet, 80000), importMessage: text(state.importMessage, 240),
      audioTaskId: validTaskId(state.audioTaskId), audioTaskRound: [0, 1].includes(state.audioTaskRound) ? state.audioTaskRound : null
    };
  }

  function normalize(value) {
    if (!value || value.schemaVersion !== SCHEMA_VERSION || !Number.isInteger(value.step) || value.step < 1 || value.step > 5) return null;
    const draft = snapshot(value);
    if (draft && typeof value.updatedAt === 'string') draft.updatedAt = value.updatedAt;
    return draft;
  }

  function load(storage) {
    try {
      const raw = (storage || localStorage).getItem(STORAGE_KEY);
      if (!raw) return { draft: null, error: '' };
      const draft = normalize(JSON.parse(raw));
      return draft ? { draft, error: '' } : { draft: null, error: '上次训练草稿版本不兼容，已忽略。' };
    } catch (_) { return { draft: null, error: '上次训练草稿损坏，已安全忽略。' }; }
  }

  function save(state, storage) {
    const draft = snapshot(state);
    if (!draft) return null;
    try { (storage || localStorage).setItem(STORAGE_KEY, JSON.stringify(draft)); } catch (_) { return null; }
    return draft;
  }

  function clear(storage) {
    try { (storage || localStorage).removeItem(STORAGE_KEY); } catch (_) {}
  }

  return { STORAGE_KEY, SCHEMA_VERSION, snapshot, normalize, load, save, clear };
});
