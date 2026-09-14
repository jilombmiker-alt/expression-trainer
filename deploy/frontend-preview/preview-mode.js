(function (root) {
  'use strict';
  const cloudRequest = root.ExpressionFrontend.requestJson.bind(root.ExpressionFrontend);
  // Included ONLY in the frontend preview bundle, never a fallback for a failed production API.
  const key = 'expression.previewRuns.v1';
  let cache;
  try { cache = JSON.parse(root.sessionStorage.getItem(key) || '{}'); } catch (_) { cache = {}; }
  if (!cache || typeof cache !== 'object' || Array.isArray(cache)) cache = {};
  cache.runs ||= {}; cache.attempts ||= {};
  function save() {
    // Bound per-tab draft storage. Completed growth records use the existing local progress store.
    for (const id of Object.keys(cache.runs).slice(0, -12)) delete cache.runs[id];
    for (const id of Object.keys(cache.attempts).slice(0, -48)) delete cache.attempts[id];
    try { root.sessionStorage.setItem(key, JSON.stringify(cache)); } catch (_) { /* in-memory practice remains available */ }
  }
  const training = {
    preview: true, modelAccess: Promise.resolve(false), sponsored: () => false,
    context() {}, event() {},
    // A local draft survives app restarts; the per-tab cache does not. Restore
    // only this preview run from its saved exercise, never a production run.
    restore(id, rounds, weights) {
      if (!/^[0-9a-f-]{36}$/i.test(id) || !Array.isArray(rounds) || rounds.length !== 2) throw new Error('训练资料不完整，请重新选择内容。');
      if (!Object.hasOwn(cache.runs, id)) { cache.runs[id] = { rounds, weights }; save(); }
    },
    async create(rounds, weights) {
      const id = root.crypto.randomUUID(); cache.runs[id] = { rounds, weights }; save(); return { id };
    },
    async start(trainingId, round, mode, id, weights) {
      if (!cache.runs[trainingId]) throw new Error('本机训练草稿已失效，请返回首页重新开始。');
      if (!cache.attempts[id]) { cache.attempts[id] = { trainingId, round, mode, weights }; save(); }
      return { id };
    },
    async assess(data) {
      const attempt = cache.attempts[data.attemptId];
      const run = attempt && cache.runs[attempt.trainingId];
      if (!run) throw new Error('本机训练草稿已失效，请返回首页重新开始。');
      if (attempt.result) return attempt.result;
      const exercise = run.rounds[attempt.round];
      const round = attempt.round === 0 ? 'first' : 'second';
      const oral = root.ExpressionAnalyzer.analyze(data.transcript);
      const content = root.ExpressionSemantic.evaluate(exercise, data.transcript);
      const elapsed = Math.max(0, Number(data.timing?.elapsedSeconds) || 0);
      // Preview evidence remains provisional; production assesses its own audio task.
      const asr = data.asr || null;
      const measurement = asr?.pauseMeasurement;
      const measured = measurement?.available === true && measurement.method === 'pcm-energy-v1';
      const pauses = measured ? (measurement.intervals || []).map(x => Number(x.durationMs) / 1000).filter(x => Number.isFinite(x) && x >= .5 && x <= 300) : [];
      const result = { oral, content, transcript: data.transcript, elapsed,
        pace: elapsed ? Math.round(oral.charCount / elapsed * 60) : 0,
        pauses, averagePause: pauses.length ? pauses.reduce((a,b)=>a+b,0) / pauses.length : 0,
        longestPause: pauses.length ? Math.max(...pauses) : 0, asr,
        pauseEvidence: measured ? { available: true, source: 'pcm-energy-v1', boundary: measurement.boundary } : null };
      result.scoring = root.ExpressionScoring.calculate(round, result, exercise, attempt.weights);
      result.baselineScoring = root.ExpressionScoring.calculate(round, result, exercise, root.ExpressionScoring.DEFAULT_WEIGHTS[round]);
      result.scoring.provisional = true; result.baselineScoring.provisional = true;
      result.preview = true; result.assessment = { mode: attempt.mode, verifiedTiming: false };
      attempt.result = result; save(); return result;
    }
  };
  root.ExpressionPreview = { training, storage: {
    getItem: (name) => root.localStorage.getItem(`frontend-preview:${name}`),
    setItem: (name, value) => root.localStorage.setItem(`frontend-preview:${name}`, value),
    removeItem: (name) => root.localStorage.removeItem(`frontend-preview:${name}`)
  } };
  // Explicit capability responses, no requests, credentials, transcripts or analytics leave through this adapter.
  root.ExpressionFrontend.requestJson = async function (path, init = {}) {
    if (path === '/api/semantic/health') return { available: false, preview: true, billingMode: 'preview', byokRequired: false };
    if (path === '/api/speech/health' || path.startsWith('/api/speech/transcribe')) return cloudRequest(path, init, { timeoutMs: path.includes('transcribe') ? 90000 : 6000 });
    if (path === '/api/privacy') return { optionalAnalytics: false };
    if (path === '/api/training/from-source') {
      const card = root.KnowledgeBuilder.buildLocal(JSON.parse(init.body));
      card.generationBoundary = '前端测试版：只按你提供的文字在浏览器内整理训练卡，未调用 AI，也未上传资料。请先核对两轮内容。';
      return card;
    }
    const error = new Error('前端测试版尚未接通这项云端功能，请先体验训练。');
    error.userMessage = error.message; error.code = 'preview_unavailable'; throw error;
  };
  root.addEventListener('DOMContentLoaded', () => {
    const modelTab = document.getElementById('model-settings-tab');
    const dataTab = document.getElementById('data-settings-tab');
    if (!dataTab) return;
    const form = document.getElementById('connection-form');
    const panel = document.getElementById('data-settings');
    function showData(active) {
      form.hidden = active; panel.hidden = !active;
      modelTab.classList.toggle('active', !active); dataTab.classList.toggle('active', active);
      modelTab.setAttribute('aria-pressed', String(!active)); dataTab.setAttribute('aria-pressed', String(active));
    }
    dataTab.addEventListener('click', () => showData(true)); modelTab.addEventListener('click', () => showData(false));
    panel.replaceChildren();
    const title = document.createElement('h2'); title.textContent = '训练记录保存在当前浏览器';
    const text = document.createElement('p'); text.textContent = '完成两轮后，可在“成长档案”查看本机训练次数、分项结果和变化。此版不会汇总其他人的记录；清除浏览器数据会丢失本机记录。云端后台将在后续接入。';
    const link = document.createElement('a'); link.href = 'concept-editorial.html?theme=v0'; link.textContent = '返回训练，查看成长档案 →';
    panel.append(title, text, link);
  });
})(window);
