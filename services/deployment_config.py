"""Fail closed on missing deployment configuration; never invent a production hostname."""
from pathlib import Path
from urllib.parse import urlsplit


def validate_deployment(env):
    if env.get('EXPRESSION_ENV', 'development') != 'production':
        return None
    origin = env.get('EXPRESSION_PUBLIC_ORIGIN', '')
    parsed = urlsplit(origin)
    if (parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password
            or parsed.path not in ('', '/') or parsed.query or parsed.fragment
            or parsed.hostname in ('localhost', '127.0.0.1', '::1') or parsed.hostname.endswith('.invalid')):
        raise ValueError('生产环境必须配置真实 HTTPS 域名 EXPRESSION_PUBLIC_ORIGIN。')
    if env.get('EXPRESSION_SECURE_COOKIE', '') != 'true':
        raise ValueError('生产环境必须启用 EXPRESSION_SECURE_COOKIE=true。')
    if env.get('EXPRESSION_MODEL_MODE', 'byok') != 'sponsored' and env.get('EXPRESSION_REQUIRE_BYOK', 'true').lower() != 'true':
        raise ValueError('默认版本必须启用 BYOK；共用模型需要显式开启 sponsored 内测模式。')
    if not 32 <= len(env.get('EXPRESSION_ADMIN_TOKEN', '')) <= 512:
        raise ValueError('请配置 32–512 字符的独立运营后台访问码。')
    data = env.get('EXPRESSION_DATA_DIR', '')
    if not data or not Path(data).is_absolute():
        raise ValueError('请将 EXPRESSION_DATA_DIR 配置为持久化磁盘的绝对路径。')
    return parsed.netloc.lower()
