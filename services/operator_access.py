"""Separate short-lived operator sessions. Never reuse BYOK or visitor credentials."""
import hmac
import os
import secrets
import threading
import time
from training_store import TrainingError, digest


class OperatorAccess:
    def __init__(self, clock=time.time):
        self.clock, self.lock = clock, threading.Lock()
        self.sessions, self.failures = {}, {}

    def login(self, owner, code):
        expected = os.getenv('EXPRESSION_ADMIN_TOKEN', '')
        if len(expected) < 32:
            raise TrainingError('operator_unconfigured', '尚未配置管理员访问码。请由产品负责人在服务器配置后重试。', 503)
        with self.lock:
            now = self.clock()
            self.failures = {key: val for key, val in self.failures.items() if now - val[0] < 300}
            count = self.failures.get(owner, (now, 0))[1]
            if count >= 5 or len(self.failures) >= 200:
                raise TrainingError('operator_rate_limited', '尝试次数过多，请 5 分钟后重试。', 429)
            if not isinstance(code, str) or len(code) > 512 or not hmac.compare_digest(code.encode(), expected.encode()):
                self.failures[owner] = (now, count + 1)
                raise TrainingError('operator_denied', '管理员访问码不正确。', 403)
            self.sessions = {key: value for key, value in self.sessions.items() if value[1] > now}
            if len(self.sessions) >= 50:
                raise TrainingError('operator_busy', '管理会话已达上限，请稍后重试。', 429)
            token = secrets.token_urlsafe(32)
            self.sessions[digest(token)] = (owner, now + 3600)
            return token

    def require(self, owner, token):
        with self.lock:
            record = self.sessions.get(digest(token))
            if not record or record[0] != owner or record[1] <= self.clock():
                raise TrainingError('operator_required', '请先验证管理员身份。普通用户不能查看全站数据。', 403)

    def logout(self, token):
        with self.lock:
            self.sessions.pop(digest(token), None)
