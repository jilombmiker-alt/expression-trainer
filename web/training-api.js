(function (root) {
  'use strict';
  if (root.ExpressionPreview) {
    root.TrainingAPI = root.ExpressionPreview.training;
    return;
  }
  const request = (path, data, timeoutMs = 12000) => root.ExpressionFrontend.requestJson(path,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }, { timeoutMs });
  const pending = [];
  let sending = false;
  let trainingId = null;
  let consent = false;
  let sponsored = false;
  const modelAccess = root.ExpressionFrontend.requestJson('/api/semantic/health').then((data) => {
    sponsored = data.billingMode === 'sponsored' && data.byokRequired === false && data.available === true;
    return sponsored;
  }).catch(() => false);
  // Never buffer pre-consent interactions or persist event payloads in browser storage.
  root.ExpressionFrontend.requestJson('/api/privacy').then((data) => { consent = data.optionalAnalytics === true; }).catch(() => {});
  async function flush() {
    if (!consent || sending || !pending.length) return;
    sending = true;
    const batch = pending.slice(0, 20);
    try { await request('/api/events', { events: batch }); pending.splice(0, batch.length); }
    catch (error) { if (error.status === 403) { consent = false; pending.length = 0; } }
    finally { sending = false; }
  }
  root.TrainingAPI = {
    modelAccess,
    sponsored: () => sponsored,
    context: (id) => { trainingId = id || null; },
    create: (rounds, weights) => request('/api/training/runs', { rounds, weights }),
    start: (trainingId, round, mode, id, weights) => request('/api/training/attempts', { trainingId, round, mode, id, weights }),
    assess: (data) => request('/api/training/assess', data, 120000),
    event(name, data = {}) {
      if (!consent) return;
      if (pending.length >= 100) pending.shift();
      pending.push({ id: root.crypto.randomUUID(), name, data, trainingId, occurredAt: Date.now() });
      void flush();
    }
  };
  root.setInterval(flush, 15000);
})(window);
