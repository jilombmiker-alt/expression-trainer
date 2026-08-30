"use strict";
(function installFrontendFoundation(root) {
    'use strict';
    function fieldErrors(value) {
        if (!value || typeof value !== 'object' || Array.isArray(value))
            return undefined;
        const safe = Object.entries(value).reduce((result, [key, item]) => {
            if (typeof item === 'string')
                result[key] = item;
            return result;
        }, {});
        return Object.keys(safe).length ? safe : undefined;
    }
    function normalizeError(value, fallback = '请求处理失败，请稍后重试。', status) {
        const payload = value && typeof value === 'object' ? value : {};
        const nested = payload.error && typeof payload.error === 'object' ? payload.error : {};
        const sourceError = value instanceof Error ? value : null;
        const message = String((nested && 'message' in nested && nested.message) || payload.message || payload.reason || sourceError?.message || fallback);
        const error = new Error(message);
        error.code = String((nested && 'code' in nested && nested.code) || sourceError?.code || 'request_failed');
        error.userMessage = message;
        error.retryable = Boolean(nested && 'retryable' in nested ? nested.retryable : sourceError?.retryable);
        error.status = status || sourceError?.status;
        if (nested && 'requestId' in nested && nested.requestId)
            error.requestId = String(nested.requestId);
        const safeFields = fieldErrors(nested && 'fieldErrors' in nested ? nested.fieldErrors : undefined);
        if (safeFields)
            error.fieldErrors = safeFields;
        return error;
    }
    async function requestJson(path, init = {}, options = {}) {
        const fetcher = options.fetcher || root.fetch.bind(root);
        const controller = new AbortController();
        const timeoutMs = Math.max(1000, Number(options.timeoutMs || 12000));
        const timeout = root.setTimeout(() => controller.abort(), timeoutMs);
        try {
            const response = await fetcher(path, { ...init, signal: init.signal || controller.signal });
            let data = {};
            try {
                data = await response.json();
            }
            catch (_) {
                data = {};
            }
            if (!response.ok)
                throw normalizeError(data, `服务返回 ${response.status}`, response.status);
            return data;
        }
        catch (cause) {
            if (cause instanceof DOMException && cause.name === 'AbortError') {
                const error = normalizeError({ error: { code: 'request_timeout', message: '服务响应时间过长，请稍后重试。', retryable: true } });
                throw error;
            }
            throw normalizeError(cause);
        }
        finally {
            root.clearTimeout(timeout);
        }
    }
    function mapTaskStatus(status, needsConfirmation = false) {
        const value = String(status || '').toLowerCase();
        if (!value)
            return 'idle';
        if (value === 'uploading')
            return 'submitting';
        if (value === 'queued')
            return 'queued';
        if (value === 'converting' || value === 'transcribing' || value === 'running')
            return 'running';
        if (value === 'streaming')
            return 'streaming';
        if (value === 'completed' || value === 'succeeded')
            return needsConfirmation ? 'waiting_user' : 'succeeded';
        if (value === 'failed')
            return 'failed';
        if (value === 'cancelled')
            return 'cancelled';
        if (value === 'disconnected')
            return 'disconnected';
        return 'stale';
    }
    function pollDelay(attempt, pageHidden = false) {
        const safeAttempt = Math.max(0, Math.min(6, Number(attempt) || 0));
        const delay = Math.min(8000, 700 * (2 ** safeAttempt));
        return pageHidden ? Math.max(5000, delay) : delay;
    }
    root.ExpressionFrontend = { requestJson, normalizeError, mapTaskStatus, pollDelay };
})(window);
