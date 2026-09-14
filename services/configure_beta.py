#!/usr/bin/env python3
"""Human-run private setup: never supply credentials as CLI arguments or in chat."""
import getpass
import argparse
import json
import os
import secrets
from pathlib import Path

from model_connections import validate_settings
from sponsored_access import validate


def main():
    parser = argparse.ArgumentParser(description='私密内测配置；不在命令行传递 API Key')
    parser.add_argument('--deepseek-light', action='store_true', help='使用已核对的 deepseek-v4-flash 非思考模式')
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    folder = root / '.private-deploy'
    folder.mkdir(mode=0o700, exist_ok=True)
    if folder.is_symlink():
        raise SystemExit('私密目录不允许是符号链接。')
    target = folder / 'beta.env'
    if target.exists():
        raise SystemExit('已有 beta.env；为避免覆盖密钥，本工具停止。请由本人在本机安全编辑。')
    provider = 'deepseek' if args.deepseek_light else input('模型厂商（deepseek / openai / anthropic / gemini）：').strip()
    model = 'deepseek-v4-flash' if args.deepseek_light else input('模型名称：').strip()
    if args.deepseek_light:
        print('配置 DeepSeek V4 Flash · 非思考模式 · 全站每日最多 100 次分析。')
    key = getpass.getpass('API Key（输入不显示，不要通过聊天发送）：').strip()
    validate_settings(provider, model, key)
    beta_password = getpass.getpass('设置内测密码（16–256 字符，与 API Key 不同）：')
    values = {
        'EXPRESSION_MODEL_MODE': 'sponsored', 'EXPRESSION_REQUIRE_BYOK': 'false',
        'EXPRESSION_BETA_PASSWORD': beta_password, 'EXPRESSION_SPONSORED_DAILY_LIMIT': '100',
        'EXPRESSION_LLM_PROVIDER': provider, 'EXPRESSION_LLM_MODEL': model, 'EXPRESSION_LLM_API_KEY': key,
        'EXPRESSION_LLM_RETRIES': '0', 'EXPRESSION_ADMIN_TOKEN': secrets.token_urlsafe(36),
    }
    validate(values)
    if any(any(char in value for char in "'\r\n") for value in values.values()):
        raise SystemExit('配置不能含单引号或换行；未写入文件，请重新设置。')
    with os.fdopen(os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'w') as stream:
        for name, value in values.items():
            # Single quotes prevent Docker Compose from interpolating dollar signs in credentials.
            stream.write(f"{name}='{value}'\n")
    print(json.dumps({'saved': str(target), 'mode': '600', 'uploaded': False}, ensure_ascii=False))


if __name__ == '__main__':
    main()
