"""Explicit host-funded beta mode. No credentials are returned to clients."""
import base64
import binascii
import hashlib
import hmac
import os
from datetime import datetime, timezone

from semantic_service import config
from training_store import TrainingError


def enabled(env=None):
    source = os.environ if env is None else env
    return source.get('EXPRESSION_MODEL_MODE', 'byok') == 'sponsored'


def validate(env):
    mode = env.get('EXPRESSION_MODEL_MODE', 'byok')
    if mode not in ('byok', 'sponsored'):
        raise ValueError('EXPRESSION_MODEL_MODE 必须为 byok 或 sponsored。')
    if mode == 'byok':
        return
    if not 16 <= len(env.get('EXPRESSION_BETA_PASSWORD', '')) <= 256:
        raise ValueError('共用模型内测必须配置 16–256 字符的独立内测密码。')
    if not 1 <= int(env.get('EXPRESSION_SPONSORED_DAILY_LIMIT', '100')) <= 1000:
        raise ValueError('内测每日调用上限必须为 1–1000 次。')
    config(env)  # Provider, model and key must all be valid before serving requests.


def authorized(header, env=None):
    source = os.environ if env is None else env
    expected = source.get('EXPRESSION_BETA_PASSWORD', '')
    if not 16 <= len(expected) <= 256 or not isinstance(header, str) or len(header) > 2048:
        return False
    try:
        scheme, encoded = header.split(' ', 1)
        if scheme.lower() != 'basic':
            return False
        username, password = base64.b64decode(encoded, validate=True).decode('utf-8').split(':', 1)
        # Digest before constant-time comparison to avoid leaking credential length.
        return hmac.compare_digest(hashlib.sha256(f'{username}:{password}'.encode()).digest(),
                                   hashlib.sha256(f'beta:{expected}'.encode()).digest())
    except (ValueError, UnicodeError, binascii.Error):
        return False


def settings():
    selected = config()
    selected['retries'] = 0
    if selected['provider'] == 'deepseek':
        # Host-funded lightweight training explicitly disables DeepSeek's default thinking mode.
        selected['thinkingMode'] = 'disabled'
    return selected


def consume(store):
    """Atomic global daily admission, persisted across process restarts. Failures still count."""
    limit = int(os.getenv('EXPRESSION_SPONSORED_DAILY_LIMIT', '100'))
    if not 1 <= limit <= 1000:
        raise TrainingError('beta_unconfigured', '内测调用上限未配置，请联系维护者。', 503)
    day = datetime.fromtimestamp(store.clock(), timezone.utc).strftime('%Y-%m-%d')
    with store.db() as db:
        db.execute('BEGIN IMMEDIATE')
        db.execute('CREATE TABLE IF NOT EXISTS sponsored_budget(day TEXT PRIMARY KEY, used INTEGER NOT NULL)')
        row = db.execute('SELECT used FROM sponsored_budget WHERE day=?', (day,)).fetchone()
        used = row['used'] if row else 0
        if used >= limit:
            raise TrainingError('beta_daily_limit', '内测今日 AI 调用次数已用完，请联系维护者或明天再试。', 429)
        db.execute('INSERT INTO sponsored_budget(day,used) VALUES(?,1) ON CONFLICT(day) DO UPDATE SET used=used+1', (day,))
        db.execute('DELETE FROM sponsored_budget WHERE day<?', (day,))
