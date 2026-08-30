(function (root, factory) {
  const api = factory(root.ExpressionFrontend);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ExpressionSpeech = api;
})(typeof self !== 'undefined' ? self : this, function (Frontend) {
  'use strict';
  const BASE = '/api/speech';
  function errorMessage(data, fallback) {
    if (data?.error && typeof data.error === 'object') return String(data.error.message || fallback);
    return String(data?.reason || data?.error || fallback);
  }
  async function health(fetcher) {
    try {
      if (!fetcher && Frontend?.requestJson) {
        const data = await Frontend.requestJson(`${BASE}/health`, { headers: { Accept: 'application/json' } }, { timeoutMs: 6000 });
        const capabilities = Array.isArray(data.capabilities) ? data.capabilities : [];
        return { available: Boolean(data.available), engine: data.engine || 'funasr', reason: data.reason || '', model: data.model || '', capabilities, chunkedTasks: capabilities.includes('chunked_tasks') };
      }
      const response = await (fetcher || fetch)(`${BASE}/health`, { headers: { Accept: 'application/json' } }); const data = await response.json();
      const capabilities = Array.isArray(data.capabilities) ? data.capabilities : [];
      return { available: Boolean(response.ok && data.available), engine: data.engine || 'funasr', reason: data.reason || '', model: data.model || '', capabilities, chunkedTasks: capabilities.includes('chunked_tasks') };
    } catch (_) { return { available: false, engine: 'browser', reason: '高精度转录服务未启动' }; }
  }
  function normalizeResult(data) {
    const confidence = data?.confidence !== null && data?.confidence !== undefined && Number.isFinite(Number(data.confidence)) ? Number(data.confidence) : null;
    const pauses = Array.isArray(data?.pauses) ? data.pauses.map(Number).filter((value) => Number.isFinite(value) && value >= .5 && value <= 20) : [];
    return {
      text: String(data?.text || '').trim(), engine: data?.engine || 'funasr', confidence, pauses,
      durationMs: Number(data?.durationMs || 0), segments: Array.isArray(data?.segments) ? data.segments : [],
      needsConfirmation: data?.needsConfirmation === true || confidence === null || confidence < .72,
      warning: String(data?.warning || '')
    };
  }
  async function transcribe(blob, options, fetcher) {
    const params = new URLSearchParams();
    if (options?.hotwords?.length) params.set('hotwords', options.hotwords.join(','));
    if (!fetcher && Frontend?.requestJson) return normalizeResult(await Frontend.requestJson(`${BASE}/transcribe?${params}`, { method: 'POST', headers: { 'Content-Type': blob.type || 'application/octet-stream' }, body: blob }, { timeoutMs: 90000 }));
    const response = await (fetcher || fetch)(`${BASE}/transcribe?${params}`, { method: 'POST', headers: { 'Content-Type': blob.type || 'application/octet-stream' }, body: blob });
    const data = await response.json();
    if (!response.ok) throw new Error(errorMessage(data, '高精度转录失败'));
    return normalizeResult(data);
  }
  async function semantic(exercise, transcript, fetcher) {
    try {
      if (!fetcher && Frontend?.requestJson) return await Frontend.requestJson('/api/semantic/evaluate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ exercise, transcript }) }, { timeoutMs: 35000 });
      const response = await (fetcher || fetch)('/api/semantic/evaluate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ exercise, transcript }) });
      const data = await response.json();
      return response.ok ? data : null;
    } catch (_) { return null; }
  }
  async function responseJson(response, fallback) {
    let data = {};
    try { data = await response.json(); } catch (_) {}
    if (!response.ok) throw new Error(errorMessage(data, fallback));
    return data;
  }
  async function createAudioTask(contentType, hotwords, fetcher) {
    if (!fetcher && Frontend?.requestJson) return Frontend.requestJson('/api/audio/tasks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contentType: contentType || 'application/octet-stream', hotwords: hotwords || [] }) });
    const response = await (fetcher || fetch)('/api/audio/tasks', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contentType: contentType || 'application/octet-stream', hotwords: hotwords || [] })
    });
    return responseJson(response, '无法创建录音任务');
  }
  async function uploadAudioChunk(taskId, index, blob, fetcher) {
    if (!fetcher && Frontend?.requestJson) return Frontend.requestJson(`/api/audio/tasks/${encodeURIComponent(taskId)}/chunks/${index}`, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: blob }, { timeoutMs: 30000 });
    const response = await (fetcher || fetch)(`/api/audio/tasks/${encodeURIComponent(taskId)}/chunks/${index}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: blob
    });
    return responseJson(response, '录音分段上传失败');
  }
  async function completeAudioTask(taskId, fetcher) {
    if (!fetcher && Frontend?.requestJson) return Frontend.requestJson(`/api/audio/tasks/${encodeURIComponent(taskId)}/complete`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    const response = await (fetcher || fetch)(`/api/audio/tasks/${encodeURIComponent(taskId)}/complete`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    return responseJson(response, '无法提交录音任务');
  }
  async function getAudioTask(taskId, fetcher) {
    if (!fetcher && Frontend?.requestJson) return Frontend.requestJson(`/api/audio/tasks/${encodeURIComponent(taskId)}`, { headers: { Accept: 'application/json' } }, { timeoutMs: 8000 });
    const response = await (fetcher || fetch)(`/api/audio/tasks/${encodeURIComponent(taskId)}`, { headers: { Accept: 'application/json' } });
    return responseJson(response, '无法读取录音进度');
  }
  async function cancelAudioTask(taskId, fetcher) {
    if (!fetcher && Frontend?.requestJson) return Frontend.requestJson(`/api/audio/tasks/${encodeURIComponent(taskId)}`, { method: 'DELETE' });
    const response = await (fetcher || fetch)(`/api/audio/tasks/${encodeURIComponent(taskId)}`, { method: 'DELETE' });
    return responseJson(response, '无法取消录音任务');
  }
  async function waitForAudioTask(taskId, onUpdate, fetcher, options) {
    const interval = Number(options?.intervalMs || 800); const timeout = Number(options?.timeoutMs || 240000); const started = Date.now(); let failures = 0;
    while (Date.now() - started < timeout) {
      let task;
      try { task = await getAudioTask(taskId, fetcher); failures = 0; }
      catch (requestError) {
        failures += 1;
        if (onUpdate) onUpdate({ status: 'disconnected', frontendState: 'disconnected', retryable: true, error: { message: requestError.userMessage || requestError.message } });
        if (failures > 3) throw requestError;
        const hidden = typeof document !== 'undefined' && document.hidden;
        await new Promise((resolve) => setTimeout(resolve, Frontend?.pollDelay ? Frontend.pollDelay(failures, hidden) : interval * failures));
        continue;
      }
      const frontendState = Frontend?.mapTaskStatus ? Frontend.mapTaskStatus(task.status, task.result?.needsConfirmation) : task.status;
      if (onUpdate) onUpdate({ ...task, frontendState });
      if (task.status === 'completed') return normalizeResult(task.result || {});
      if (task.status === 'failed' || task.status === 'cancelled') {
        const taskError = new Error(task.error?.message || '录音任务未完成'); taskError.taskStatus = task.status; throw taskError;
      }
      if (frontendState === 'stale') throw new Error('录音任务返回了未知状态，请刷新后重试。');
      const hidden = typeof document !== 'undefined' && document.hidden;
      await new Promise((resolve) => setTimeout(resolve, hidden ? Math.max(5000, interval) : interval));
    }
    throw new Error('录音处理时间过长，可以稍后恢复这次任务。');
  }
  return { health, normalizeResult, errorMessage, transcribe, semantic, createAudioTask, uploadAudioChunk, completeAudioTask, getAudioTask, cancelAudioTask, waitForAudioTask };
});
