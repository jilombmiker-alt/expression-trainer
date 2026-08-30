"""Persistent single-user audio task records for the P0 local service."""
import json
import os
import shutil
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path

SCHEMA_VERSION = 1
ACTIVE_STATES = {"queued", "converting", "transcribing"}
TERMINAL_STATES = {"completed", "failed", "cancelled"}
ALLOWED_CONTENT_TYPES = {"audio/webm", "audio/mp4", "audio/ogg", "application/octet-stream"}


def detect_audio_type(body):
    sample = bytes(body[:32]) if body else b""
    if sample.startswith(b"\x1a\x45\xdf\xa3"):
        return "audio/webm"
    if sample.startswith(b"OggS"):
        return "audio/ogg"
    if len(sample) >= 12 and sample[4:8] == b"ftyp":
        return "audio/mp4"
    return None


def now_iso():
    return datetime.now(timezone.utc).isoformat()


class AudioTaskError(Exception):
    def __init__(self, code, message, status=400):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status


class AudioTaskStore:
    def __init__(self, root, max_total_bytes=80 * 1024 * 1024, max_chunk_bytes=6 * 1024 * 1024):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)
        self.max_total_bytes = max_total_bytes
        self.max_chunk_bytes = max_chunk_bytes
        self.lock = threading.RLock()
        self.recover_incomplete()

    def _dir(self, task_id):
        if not isinstance(task_id, str) or len(task_id) != 36 or any(char not in "0123456789abcdef-" for char in task_id):
            raise AudioTaskError("audio_task_not_found", "没有找到这次录音任务。", 404)
        return self.root / task_id

    def _path(self, task_id):
        return self._dir(task_id) / "task.json"

    def _read(self, task_id):
        path = self._path(task_id)
        try:
            value = json.loads(path.read_text(encoding="utf-8"))
        except FileNotFoundError:
            raise AudioTaskError("audio_task_not_found", "没有找到这次录音任务。", 404)
        except (OSError, json.JSONDecodeError):
            raise AudioTaskError("audio_task_corrupt", "录音任务记录损坏，请重新录制。", 500)
        if value.get("schemaVersion") != SCHEMA_VERSION or value.get("id") != task_id:
            raise AudioTaskError("audio_task_corrupt", "录音任务版本不兼容，请重新录制。", 500)
        return value

    def _write(self, task):
        folder = self._dir(task["id"])
        folder.mkdir(parents=True, exist_ok=True)
        path = folder / "task.json"
        temp = folder / "task.json.tmp"
        temp.write_text(json.dumps(task, ensure_ascii=False, indent=2), encoding="utf-8")
        os.replace(str(temp), str(path))

    def create(self, content_type, hotwords=None):
        mime = str(content_type or "application/octet-stream").split(";", 1)[0].strip().lower()
        if mime not in ALLOWED_CONTENT_TYPES:
            raise AudioTaskError("audio_format_unsupported", "只支持浏览器产生的 WebM、MP4 或 OGG 音频。", 415)
        task_id = str(uuid.uuid4())
        created = now_iso()
        task = {
            "schemaVersion": SCHEMA_VERSION, "id": task_id, "status": "uploading", "progress": 0,
            "createdAt": created, "updatedAt": created, "contentType": mime,
            "hotwords": [str(item)[:30] for item in (hotwords or []) if str(item).strip()][:24],
            "chunks": [], "bytesReceived": 0, "result": None, "error": None, "retryable": False,
        }
        with self.lock:
            self._write(task)
        return self.public(task)

    def add_chunk(self, task_id, index, body):
        if not isinstance(index, int) or index < 0 or index > 600:
            raise AudioTaskError("audio_chunk_invalid", "录音分段编号不正确。")
        if not body or len(body) > self.max_chunk_bytes:
            raise AudioTaskError("audio_chunk_invalid", "录音分段为空或过大。", 413)
        with self.lock:
            task = self._read(task_id)
            if task["status"] != "uploading":
                raise AudioTaskError("audio_task_not_uploading", "这次录音已经结束上传。", 409)
            if index != len(task["chunks"]):
                raise AudioTaskError("audio_chunk_out_of_order", "录音分段顺序不连续，请重新录制。", 409)
            if index == 0:
                detected = detect_audio_type(body)
                if not detected:
                    raise AudioTaskError("audio_content_invalid", "录音内容不是可识别的 WebM、MP4 或 OGG 音频。", 415)
                if task["contentType"] != "application/octet-stream" and task["contentType"] != detected:
                    raise AudioTaskError("audio_content_mismatch", "录音内容与声明格式不一致，请重新录制。", 415)
                task["contentType"] = detected
            if task["bytesReceived"] + len(body) > self.max_total_bytes:
                raise AudioTaskError("audio_too_large", "录音总大小超过 80MB，请缩短后重试。", 413)
            folder = self._dir(task_id) / "chunks"
            folder.mkdir(parents=True, exist_ok=True)
            name = f"{index:06d}.part"
            (folder / name).write_bytes(body)
            task["chunks"].append(name)
            task["bytesReceived"] += len(body)
            task["progress"] = min(35, 5 + len(task["chunks"]) * 2)
            task["updatedAt"] = now_iso()
            self._write(task)
            return self.public(task)

    def submit(self, task_id):
        with self.lock:
            task = self._read(task_id)
            if task["status"] != "uploading" or not task["chunks"]:
                raise AudioTaskError("audio_task_not_ready", "录音还没有可处理的分段。", 409)
            task["status"] = "queued"
            task["progress"] = max(36, task["progress"])
            task["updatedAt"] = now_iso()
            self._write(task)
            return self.public(task)

    def update(self, task_id, status=None, progress=None, result=None, error=None, retryable=None):
        with self.lock:
            task = self._read(task_id)
            if task["status"] == "cancelled" and status != "cancelled":
                return self.public(task)
            if status:
                task["status"] = status
            if progress is not None:
                task["progress"] = max(0, min(100, int(progress)))
            if result is not None:
                task["result"] = result
            if error is not None:
                task["error"] = error
            if retryable is not None:
                task["retryable"] = bool(retryable)
            task["updatedAt"] = now_iso()
            self._write(task)
            return self.public(task)

    def get(self, task_id):
        with self.lock:
            return self.public(self._read(task_id))

    def internal(self, task_id):
        with self.lock:
            return self._read(task_id)

    def cancel(self, task_id):
        with self.lock:
            task = self._read(task_id)
            if task["status"] in TERMINAL_STATES:
                return self.public(task)
            task["status"] = "cancelled"
            task["progress"] = 100
            task["error"] = {"code": "audio_task_cancelled", "message": "录音任务已取消。"}
            task["updatedAt"] = now_iso()
            self._write(task)
            self.cleanup_media(task_id)
            return self.public(task)

    def task_dir(self, task_id):
        self._read(task_id)
        return self._dir(task_id)

    def cleanup_media(self, task_id):
        folder = self._dir(task_id)
        shutil.rmtree(str(folder / "chunks"), ignore_errors=True)
        for name in ("source.webm", "source.mp4", "source.ogg", "source.audio", "input.wav"):
            try:
                (folder / name).unlink()
            except FileNotFoundError:
                pass

    def recover_incomplete(self):
        for path in self.root.glob("*/task.json"):
            try:
                task = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                continue
            if task.get("status") in ACTIVE_STATES:
                task["status"] = "failed"
                task["progress"] = 100
                task["retryable"] = True
                task["error"] = {"code": "service_restarted", "message": "服务重新启动，请重新提交这次录音。"}
                task["updatedAt"] = now_iso()
                try:
                    self._write(task)
                except (OSError, AudioTaskError):
                    continue

    @staticmethod
    def public(task):
        return {key: task.get(key) for key in (
            "schemaVersion", "id", "status", "progress", "createdAt", "updatedAt",
            "contentType", "bytesReceived", "result", "error", "retryable"
        )}
