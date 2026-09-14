#!/usr/bin/env python3
"""Local launcher with a private operator credential. Does not publish any network port."""
import os
import secrets
import stat
import sys
from pathlib import Path

root = Path(__file__).resolve().parents[1]
data = Path(os.getenv('EXPRESSION_DATA_DIR', str(root / '.p0-data'))).resolve()
data.mkdir(parents=True, exist_ok=True)
code_path = data / 'operator-access-code.txt'
if not os.getenv('EXPRESSION_ADMIN_TOKEN'):
    try:
        descriptor = os.open(code_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except FileExistsError:
        if code_path.is_symlink() or stat.S_IMODE(code_path.stat().st_mode) & 0o077:
            raise SystemExit('后台访问码文件权限过宽或是符号链接，请先检查；未读取其内容。')
    else:
        with os.fdopen(descriptor, 'w') as target:
            target.write(secrets.token_urlsafe(36) + '\n')
    code = code_path.read_text().strip()
    if not 32 <= len(code) <= 512:
        raise SystemExit('后台访问码长度应为 32–512 字符。')
    os.environ['EXPRESSION_ADMIN_TOKEN'] = code
    print(f'运营后台访问码仅保存在本机：{code_path}', flush=True)
os.environ['EXPRESSION_DATA_DIR'] = str(data)
os.chdir(root)
os.execv(sys.executable, [sys.executable, str(root / 'services' / 'p0_service.py'), '--web-dir', 'web', *sys.argv[1:]])
