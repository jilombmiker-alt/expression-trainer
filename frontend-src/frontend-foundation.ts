type FrontendTaskState =
  | 'idle' | 'submitting' | 'queued' | 'running' | 'streaming'
  | 'waiting_user' | 'succeeded' | 'failed' | 'cancelled'
  | 'disconnected' | 'stale';

type ErrorPayload = {
  error?: {
    code?: unknown;
    message?: unknown;
    retryable?: unknown;
    requestId?: unknown;
    fieldErrors?: unknown;
  } | unknown;
  message?: unknown;
  reason?: unknown;
};

type AppError = Error & {
  code: string;
  userMessage: string;
  retryable: boolean;
  status?: number;
  requestId?: string;
  fieldErrors?: Record<string, string>;
};

type RequestOptions = {
  timeoutMs?: number;
  fetcher?: typeof fetch;
};

type FrontendFoundation = {
  requestJson<T>(path: string, init?: RequestInit, options?: RequestOptions): Promise<T>;
  normalizeError(value: unknown, fallback?: string, status?: number): AppError;
  mapTaskStatus(status: unknown, needsConfirmation?: boolean): FrontendTaskState;
  pollDelay(attempt: number, pageHidden?: boolean): number;
  runOnce<T>(key: string, operation: () => Promise<T>): Promise<T>;
};

interface Window {
  ExpressionFrontend?: FrontendFoundation;
}

(function installFrontendFoundation(root: Window) {
  'use strict';
  const pending = new Map<string, Promise<unknown>>();

  function fieldErrors(value: unknown): Record<string, string> | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const safe = Object.entries(value).reduce<Record<string, string>>((result, [key, item]) => {
      if (typeof item === 'string') result[key] = item;
      return result;
    }, {});
    return Object.keys(safe).length ? safe : undefined;
  }

  function normalizeError(value: unknown, fallback = '请求处理失败，请稍后重试。', status?: number): AppError {
    const payload = value && typeof value === 'object' ? value as ErrorPayload : {};
    const nested = payload.error && typeof payload.error === 'object' ? payload.error as NonNullable<ErrorPayload['error']> : {};
    const sourceError = value instanceof Error ? value : null;
    const message = String(
      (nested && 'message' in nested && nested.message) || payload.message || payload.reason || sourceError?.message || fallback
    );
    const error = new Error(message) as AppError;
    error.code = String((nested && 'code' in nested && nested.code) || (sourceError as AppError | null)?.code || 'request_failed');
    error.userMessage = message;
    error.retryable = Boolean(nested && 'retryable' in nested ? nested.retryable : (sourceError as AppError | null)?.retryable);
    const resolvedStatus = status || (sourceError as AppError | null)?.status;
    if (resolvedStatus !== undefined) error.status = resolvedStatus;
    if (nested && 'requestId' in nested && nested.requestId) error.requestId = String(nested.requestId);
    const safeFields = fieldErrors(nested && 'fieldErrors' in nested ? nested.fieldErrors : undefined);
    if (safeFields) error.fieldErrors = safeFields;
    return error;
  }

  async function requestJson<T>(path: string, init: RequestInit = {}, options: RequestOptions = {}): Promise<T> {
    const fetcher = options.fetcher || root.fetch.bind(root);
    const controller = new AbortController();
    const timeoutMs = Math.max(1000, Number(options.timeoutMs || 12000));
    const timeout = root.setTimeout(() => controller.abort(), timeoutMs);
    try {
      const headers = new Headers(init.headers || {});
      if (path.startsWith('/api/semantic/') || path === '/api/training/assess') {
        try {
          const connectionId = root.sessionStorage?.getItem('expression.modelConnection.v1');
          if (connectionId) headers.set('X-Model-Connection', connectionId);
        } catch (_) {
          // Storage can be disabled by privacy settings; the backend returns a safe BYOK prompt.
        }
      }
      const response = await fetcher(path, { ...init, headers, signal: init.signal || controller.signal });
      let data: unknown = {};
      try { data = await response.json(); } catch (_) { data = {}; }
      if (!response.ok) throw normalizeError(data, `服务返回 ${response.status}`, response.status);
      return data as T;
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') {
        const error = normalizeError({ error: { code: 'request_timeout', message: '服务响应时间过长，请稍后重试。', retryable: true } });
        throw error;
      }
      throw normalizeError(cause);
    } finally {
      root.clearTimeout(timeout);
    }
  }

  function mapTaskStatus(status: unknown, needsConfirmation = false): FrontendTaskState {
    const value = String(status || '').toLowerCase();
    if (!value) return 'idle';
    if (value === 'uploading') return 'submitting';
    if (value === 'queued') return 'queued';
    if (value === 'converting' || value === 'transcribing' || value === 'running') return 'running';
    if (value === 'streaming') return 'streaming';
    if (value === 'completed' || value === 'succeeded') return needsConfirmation ? 'waiting_user' : 'succeeded';
    if (value === 'failed') return 'failed';
    if (value === 'cancelled') return 'cancelled';
    if (value === 'disconnected') return 'disconnected';
    return 'stale';
  }

  function pollDelay(attempt: number, pageHidden = false): number {
    const safeAttempt = Math.max(0, Math.min(6, Number(attempt) || 0));
    const delay = Math.min(8000, 700 * (2 ** safeAttempt));
    return pageHidden ? Math.max(5000, delay) : delay;
  }

  function runOnce<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const existing = pending.get(key);
    if (existing) return existing as Promise<T>;
    const task = Promise.resolve().then(operation).finally(() => pending.delete(key));
    pending.set(key, task);
    return task;
  }

  root.ExpressionFrontend = { requestJson, normalizeError, mapTaskStatus, pollDelay, runOnce };
})(window);
