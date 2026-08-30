"""Ephemeral BYOK model connections with an allowlisted provider registry."""
from __future__ import annotations

import json
import os
import re
import secrets
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone


PROVIDERS = {
    "openai": {
        "label": "OpenAI",
        "adapter": "openai",
        "baseUrl": "https://api.openai.com/v1",
        "keyHint": "sk-…",
        "modelHint": "填写你账户中可用的模型名称",
    },
    "deepseek": {
        "label": "DeepSeek",
        "adapter": "openai",
        "baseUrl": "https://api.deepseek.com",
        "keyHint": "sk-…",
        "modelHint": "例如 deepseek-chat",
    },
    "anthropic": {
        "label": "Anthropic Claude",
        "adapter": "anthropic",
        "baseUrl": "https://api.anthropic.com/v1",
        "keyHint": "sk-ant-…",
        "modelHint": "填写你账户中可用的 Claude 模型名称",
    },
    "gemini": {
        "label": "Google Gemini",
        "adapter": "gemini",
        "baseUrl": "https://generativelanguage.googleapis.com/v1beta",
        "keyHint": "AIza…",
        "modelHint": "例如 gemini-2.5-flash",
    },
}
MODEL_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{1,119}$")


class ModelConnectionError(Exception):
    def __init__(self, code, message, status=400, retryable=False, internal=""):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status
        self.retryable = retryable
        self.internal = internal


def provider_catalog():
    return [
        {
            "id": provider_id,
            "label": provider["label"],
            "keyHint": provider["keyHint"],
            "modelHint": provider["modelHint"],
        }
        for provider_id, provider in PROVIDERS.items()
    ]


def validate_settings(provider, model, api_key, environ=None):
    provider_id = str(provider or "").strip().lower()
    model_name = str(model or "").strip()
    secret = str(api_key or "").strip()
    if provider_id not in PROVIDERS:
        raise ModelConnectionError("provider_not_supported", "暂不支持这个模型厂商。")
    if not MODEL_PATTERN.fullmatch(model_name):
        raise ModelConnectionError("model_invalid", "请填写正确的模型名称。")
    if not 8 <= len(secret) <= 512 or any(char.isspace() for char in secret):
        raise ModelConnectionError("api_key_invalid", "API Key 格式不正确。")
    env = environ or os.environ
    try:
        timeout = max(3, min(90, int(env.get("EXPRESSION_LLM_TIMEOUT_SECONDS", "30"))))
        retries = max(0, min(2, int(env.get("EXPRESSION_LLM_RETRIES", "1"))))
    except ValueError as exc:
        raise ModelConnectionError("model_config_invalid", "模型连接配置格式不正确。", 503, internal=str(exc))
    provider_config = PROVIDERS[provider_id]
    return {
        "provider": provider_id,
        "providerLabel": provider_config["label"],
        "adapter": provider_config["adapter"],
        "baseUrl": provider_config["baseUrl"],
        "model": model_name,
        "apiKey": secret,
        "timeout": timeout,
        "retries": retries,
    }


def masked_key(api_key):
    if len(api_key) <= 10:
        return f"{api_key[:2]}••••{api_key[-2:]}"
    return f"{api_key[:5]}••••••{api_key[-4:]}"


def _iso_timestamp(timestamp):
    return datetime.fromtimestamp(timestamp, timezone.utc).isoformat().replace("+00:00", "Z")


class ModelConnectionStore:
    def __init__(self, ttl_seconds=None, maximum=200, clock=None):
        env_ttl = os.getenv("EXPRESSION_BYOK_TTL_SECONDS", "28800")
        self.ttl_seconds = max(300, min(86400, int(ttl_seconds if ttl_seconds is not None else env_ttl)))
        self.maximum = max(1, int(maximum))
        self.clock = clock or time.time
        self._connections = {}
        self._lock = threading.Lock()

    def _purge_locked(self, now):
        expired = [connection_id for connection_id, item in self._connections.items() if item["expiresAtRaw"] <= now]
        for connection_id in expired:
            self._connections.pop(connection_id, None)

    def create(self, provider, model, api_key):
        settings = validate_settings(provider, model, api_key)
        now = self.clock()
        connection_id = secrets.token_urlsafe(32)
        item = {
            **settings,
            "connectionId": connection_id,
            "createdAtRaw": now,
            "expiresAtRaw": now + self.ttl_seconds,
        }
        with self._lock:
            self._purge_locked(now)
            if len(self._connections) >= self.maximum:
                oldest = min(self._connections, key=lambda key: self._connections[key]["createdAtRaw"])
                self._connections.pop(oldest, None)
            self._connections[connection_id] = item
        return self.public(item)

    def resolve(self, connection_id):
        token = str(connection_id or "").strip()
        now = self.clock()
        with self._lock:
            self._purge_locked(now)
            item = self._connections.get(token)
            if not item:
                raise ModelConnectionError("model_connection_missing", "模型连接不存在或已经过期，请重新接入。", 401)
            return dict(item)

    def inspect(self, connection_id):
        return self.public(self.resolve(connection_id))

    def delete(self, connection_id):
        token = str(connection_id or "").strip()
        with self._lock:
            existed = self._connections.pop(token, None) is not None
        return {"disconnected": existed}

    @staticmethod
    def public(item):
        return {
            "connectionId": item["connectionId"],
            "provider": item["provider"],
            "providerLabel": item["providerLabel"],
            "model": item["model"],
            "maskedKey": masked_key(item["apiKey"]),
            "expiresAt": _iso_timestamp(item["expiresAtRaw"]),
        }


def build_request(settings, prompt, max_tokens=1200, json_mode=True):
    adapter = settings["adapter"]
    headers = {"Content-Type": "application/json"}
    if adapter == "openai":
        endpoint = f'{settings["baseUrl"]}/chat/completions'
        headers["Authorization"] = f'Bearer {settings["apiKey"]}'
        body = {
            "model": settings["model"],
            "temperature": 0,
            "max_tokens": max_tokens,
            "messages": [{"role": "user", "content": prompt}],
        }
        if json_mode:
            body["response_format"] = {"type": "json_object"}
    elif adapter == "anthropic":
        endpoint = f'{settings["baseUrl"]}/messages'
        headers["x-api-key"] = settings["apiKey"]
        headers["anthropic-version"] = "2023-06-01"
        body = {
            "model": settings["model"],
            "max_tokens": max_tokens,
            "temperature": 0,
            "messages": [{"role": "user", "content": prompt}],
        }
    elif adapter == "gemini":
        model = urllib.parse.quote(settings["model"], safe="._:-")
        endpoint = f'{settings["baseUrl"]}/models/{model}:generateContent'
        headers["x-goog-api-key"] = settings["apiKey"]
        body = {
            "contents": [{"parts": [{"text": prompt}]}],
            "generationConfig": {"temperature": 0, "maxOutputTokens": max_tokens},
        }
        if json_mode:
            body["generationConfig"]["responseMimeType"] = "application/json"
    else:
        raise ModelConnectionError("provider_not_supported", "暂不支持这个模型厂商。")
    return urllib.request.Request(
        endpoint,
        data=json.dumps(body, ensure_ascii=False).encode("utf-8"),
        method="POST",
        headers=headers,
    )


def parse_text_response(remote, adapter):
    try:
        if adapter == "openai":
            return remote["choices"][0]["message"]["content"], remote.get("usage", {})
        if adapter == "anthropic":
            text = "".join(item.get("text", "") for item in remote["content"] if item.get("type") == "text")
            return text, remote.get("usage", {})
        if adapter == "gemini":
            text = "".join(item.get("text", "") for item in remote["candidates"][0]["content"]["parts"])
            return text, remote.get("usageMetadata", {})
    except (KeyError, IndexError, TypeError) as exc:
        raise ModelConnectionError("model_output_invalid", "模型返回了无法识别的内容。", 502, True, str(exc))
    raise ModelConnectionError("provider_not_supported", "暂不支持这个模型厂商。")


def request_model(settings, prompt, opener=None, max_tokens=1200, json_mode=True):
    request = build_request(settings, prompt, max_tokens=max_tokens, json_mode=json_mode)
    open_url = opener or urllib.request.urlopen
    try:
        with open_url(request, timeout=settings["timeout"]) as response:
            remote = json.loads(response.read().decode("utf-8"))
        text, usage = parse_text_response(remote, settings["adapter"])
        if not str(text or "").strip():
            raise ModelConnectionError("model_output_invalid", "模型没有返回可用内容。", 502, True)
        return str(text), usage, remote
    except ModelConnectionError:
        raise
    except urllib.error.HTTPError as exc:
        if exc.code in (401, 403):
            raise ModelConnectionError("model_auth_failed", "API Key 或模型权限不正确。", 401, False, str(exc.code))
        if exc.code == 404:
            raise ModelConnectionError("model_not_found", "没有找到这个模型，请核对模型名称。", 400, False, str(exc.code))
        if exc.code == 429:
            raise ModelConnectionError("model_quota_exceeded", "模型额度不足或请求过于频繁。", 429, True, str(exc.code))
        raise ModelConnectionError("model_request_failed", "模型厂商暂时没有完成请求。", 502, exc.code >= 500, str(exc.code))
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
        raise ModelConnectionError("model_connection_failed", "无法连接模型厂商，请稍后重试。", 502, True, str(exc))


def test_connection(settings, opener=None):
    text, _, _ = request_model(
        settings,
        '只回复 JSON：{"ok":true}。不要添加解释。',
        opener=opener,
        max_tokens=32,
        json_mode=True,
    )
    try:
        value = json.loads(text)
    except json.JSONDecodeError as exc:
        raise ModelConnectionError("model_test_invalid", "模型已经连接，但没有按预期返回测试结果。", 502, True, str(exc))
    if value.get("ok") is not True:
        raise ModelConnectionError("model_test_invalid", "模型已经连接，但测试结果不完整。", 502, True)
    return {"connected": True, "provider": settings["provider"], "model": settings["model"]}
