#!/usr/bin/env python3
"""P0 local gateway: static web, optional FunASR, and session-scoped BYOK semantics."""
import argparse
import importlib.util
import json
import os
import shutil
import subprocess
import tempfile
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from semantic_service import SemanticServiceError, evaluate as evaluate_semantic, health as semantic_health
from model_connections import (
    ModelConnectionError,
    ModelConnectionStore,
    provider_catalog,
    test_connection,
)
from audio_tasks import AudioTaskError, AudioTaskStore, detect_audio_type
from api_contract import error_payload
from knowledge_service import KnowledgeServiceError, build_card

PROJECT_ROOT = Path(__file__).resolve().parents[1]
os.environ.setdefault("MODELSCOPE_CACHE", str(PROJECT_ROOT / ".model-cache"))
MODEL = None
MODEL_ERROR = None
MODEL_LOCK = threading.Lock()
INFERENCE_LOCK = threading.Lock()
AUDIO_TASKS = AudioTaskStore(PROJECT_ROOT / ".p0-data" / "audio-tasks")
MODEL_CONNECTIONS = ModelConnectionStore()


def ffmpeg_path():
    configured = os.getenv("EXPRESSION_FFMPEG_PATH")
    if configured and Path(configured).is_file():
        return configured
    system = shutil.which("ffmpeg")
    if system:
        return system
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        return None


def load_model():
    global MODEL, MODEL_ERROR
    if MODEL is not None or MODEL_ERROR is not None:
        return MODEL
    with MODEL_LOCK:
        if MODEL is not None or MODEL_ERROR is not None:
            return MODEL
        try:
            from funasr import AutoModel
            MODEL = AutoModel(
                model=os.getenv("FUNASR_MODEL", "paraformer-zh"),
                vad_model=os.getenv("FUNASR_VAD_MODEL", "fsmn-vad"),
                punc_model=os.getenv("FUNASR_PUNC_MODEL", "ct-punc"),
                disable_update=True,
            )
        except Exception as exc:
            MODEL_ERROR = str(exc)
    return MODEL


def json_bytes(value):
    return json.dumps(value, ensure_ascii=False).encode("utf-8")


def derive_segments(item):
    raw = item.get("sentence_info") or item.get("sentences") or []
    segments = []
    for entry in raw:
        start = entry.get("start") or entry.get("start_time")
        end = entry.get("end") or entry.get("end_time")
        if start is not None and end is not None:
            segments.append({"start": float(start), "end": float(end), "text": entry.get("text", "")})
    if not segments and item.get("timestamp"):
        for index, span in enumerate(item["timestamp"]):
            if isinstance(span, (list, tuple)) and len(span) >= 2:
                segments.append({"start": float(span[0]), "end": float(span[1]), "text": "", "index": index})
    return segments


def derive_pauses(segments):
    pauses = []
    for left, right in zip(segments, segments[1:]):
        gap = (right["start"] - left["end"]) / 1000
        if .5 <= gap <= 20:
            pauses.append(round(gap, 1))
    return pauses


def transcribe_wav(wav, hotwords=""):
    model = load_model()
    if model is None:
        raise RuntimeError("speech_model_unavailable")
    with INFERENCE_LOCK:
        result = model.generate(input=str(wav), hotword=hotwords, batch_size_s=300)
    item = result[0] if result else {}
    segments = derive_segments(item)
    confidence = item.get("confidence") or item.get("score")
    confidence = float(confidence) if confidence is not None else None
    duration_ms = int(segments[-1]["end"]) if segments else 0
    return {
        "engine": "funasr", "text": item.get("text", ""), "confidence": confidence,
        "segments": segments, "pauses": derive_pauses(segments), "durationMs": duration_ms,
        "needsConfirmation": confidence is None or confidence < .72,
        "warning": "模型未返回整体置信度，请人工核对转录稿。" if confidence is None else "",
    }


def process_audio_task(task_id):
    try:
        task = AUDIO_TASKS.internal(task_id)
        if task["status"] == "cancelled":
            return
        AUDIO_TASKS.update(task_id, status="converting", progress=45)
        folder = AUDIO_TASKS.task_dir(task_id)
        suffix = {"audio/webm": ".webm", "audio/mp4": ".mp4", "audio/ogg": ".ogg"}.get(task["contentType"], ".audio")
        source = folder / f"source{suffix}"
        with source.open("wb") as target:
            for name in task["chunks"]:
                target.write((folder / "chunks" / name).read_bytes())
        wav = folder / "input.wav"
        converter = ffmpeg_path()
        if not converter:
            raise RuntimeError("audio_converter_unavailable")
        subprocess.run([converter, "-loglevel", "error", "-y", "-i", str(source), "-ac", "1", "-ar", "16000", str(wav)], check=True, timeout=180)
        if AUDIO_TASKS.internal(task_id)["status"] == "cancelled":
            return
        AUDIO_TASKS.update(task_id, status="transcribing", progress=70)
        result = transcribe_wav(wav, ",".join(task.get("hotwords") or []))
        if AUDIO_TASKS.internal(task_id)["status"] != "cancelled":
            AUDIO_TASKS.update(task_id, status="completed", progress=100, result=result, error=None, retryable=False)
    except (AudioTaskError, subprocess.SubprocessError, OSError, RuntimeError, TimeoutError):
        try:
            AUDIO_TASKS.update(task_id, status="failed", progress=100, error={"code": "audio_processing_failed", "message": "录音处理失败，请重新提交。"}, retryable=True)
        except AudioTaskError:
            pass
    finally:
        try:
            AUDIO_TASKS.cleanup_media(task_id)
        except AudioTaskError:
            pass


class Handler(SimpleHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def send_json(self, status, payload):
        body = json_bytes(payload)
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/api/speech/health":
            installed = importlib.util.find_spec("funasr") is not None
            converter = ffmpeg_path() is not None
            ready = MODEL is not None
            self.send_json(200, {
                "available": installed and converter and ready,
                "engine": "funasr",
                "model": os.getenv("FUNASR_MODEL", "paraformer-zh"),
                "capabilities": ["chunked_tasks", "timestamp_pauses"],
                "reason": "" if installed and converter and ready else (MODEL_ERROR or ("FunASR 未安装" if not installed else ("ffmpeg 未安装" if not converter else "模型尚未加载"))),
            })
            return
        if path == "/api/semantic/health":
            self.send_json(200, {**semantic_health(), "byokRequired": os.getenv("EXPRESSION_REQUIRE_BYOK", "true").lower() != "false"})
            return
        if path == "/api/model-connections/providers":
            self.send_json(200, {"providers": provider_catalog(), "storage": "server_memory", "ttlSeconds": MODEL_CONNECTIONS.ttl_seconds})
            return
        if path.startswith("/api/model-connections/"):
            connection_id = path.rsplit("/", 1)[-1]
            try:
                self.send_json(200, MODEL_CONNECTIONS.inspect(connection_id))
            except ModelConnectionError as exc:
                self.send_json(exc.status, error_payload(exc.code, exc.message, exc.retryable))
            return
        if path.startswith("/api/audio/tasks/"):
            task_id = path.rsplit("/", 1)[-1]
            try:
                self.send_json(200, AUDIO_TASKS.get(task_id))
            except AudioTaskError as exc:
                self.send_json(exc.status, error_payload(exc.code, exc.message))
            return
        super().do_GET()

    def do_POST(self):
        path = urlparse(self.path).path
        if path == "/api/speech/transcribe":
            self.transcribe()
        elif path == "/api/semantic/evaluate":
            self.semantic()
        elif path == "/api/model-connections":
            self.create_model_connection()
        elif path.startswith("/api/model-connections/") and path.endswith("/test"):
            self.test_model_connection(path.split("/")[-2])
        elif path == "/api/audio/tasks":
            self.create_audio_task()
        elif path == "/api/training/from-source":
            self.create_training_card()
        elif path.startswith("/api/audio/tasks/") and path.endswith("/complete"):
            self.complete_audio_task(path.split("/")[-2])
        else:
            self.send_json(404, error_payload("not_found", "没有找到这个接口。"))

    def do_PUT(self):
        path = urlparse(self.path).path
        parts = path.split("/")
        if len(parts) == 7 and parts[1:4] == ["api", "audio", "tasks"] and parts[5] == "chunks":
            try:
                body = self.read_body(AUDIO_TASKS.max_chunk_bytes)
                task = AUDIO_TASKS.add_chunk(parts[4], int(parts[6]), body)
                self.send_json(200, task)
            except (ValueError, AudioTaskError) as exc:
                if isinstance(exc, AudioTaskError):
                    self.send_json(exc.status, error_payload(exc.code, exc.message))
                else:
                    self.send_json(400, error_payload("audio_chunk_invalid", "录音分段编号不正确。"))
            return
        self.send_json(404, error_payload("not_found", "没有找到这个接口。"))

    def do_DELETE(self):
        path = urlparse(self.path).path
        if path.startswith("/api/audio/tasks/"):
            try:
                self.send_json(200, AUDIO_TASKS.cancel(path.rsplit("/", 1)[-1]))
            except AudioTaskError as exc:
                self.send_json(exc.status, error_payload(exc.code, exc.message))
            return
        if path.startswith("/api/model-connections/"):
            connection_id = path.rsplit("/", 1)[-1]
            self.send_json(200, MODEL_CONNECTIONS.delete(connection_id))
            return
        self.send_json(404, error_payload("not_found", "没有找到这个接口。"))

    def read_body(self, limit=20 * 1024 * 1024):
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0 or length > limit:
            raise ValueError("上传内容为空或超过 20MB")
        return self.rfile.read(length)

    def transcribe(self):
        try:
            body = self.read_body()
        except ValueError as exc:
            self.send_json(400, error_payload("invalid_audio", str(exc)))
            return
        declared = self.headers.get("Content-Type", "application/octet-stream").split(";", 1)[0].strip().lower()
        detected = detect_audio_type(body)
        if not detected:
            self.send_json(415, error_payload("audio_content_invalid", "录音内容不是可识别的 WebM、MP4 或 OGG 音频。"))
            return
        if declared in {"audio/webm", "audio/mp4", "audio/ogg"} and declared != detected:
            self.send_json(415, error_payload("audio_content_mismatch", "录音内容与声明格式不一致，请重新录制。"))
            return
        model = load_model()
        if model is None:
            self.send_json(503, error_payload("funasr_unavailable", MODEL_ERROR or "FunASR 未安装"))
            return
        try:
            suffix = {"audio/webm": ".webm", "audio/mp4": ".mp4", "audio/ogg": ".ogg"}[detected]
            with tempfile.TemporaryDirectory(prefix="expr-p0-") as folder:
                source = Path(folder) / f"input{suffix}"
                wav = Path(folder) / "input.wav"
                source.write_bytes(body)
                converter = ffmpeg_path()
                if not converter:
                    raise RuntimeError("未找到 ffmpeg，无法把浏览器录音转换为 16kHz WAV")
                subprocess.run([converter, "-loglevel", "error", "-y", "-i", str(source), "-ac", "1", "-ar", "16000", str(wav)], check=True, timeout=60)
                query = parse_qs(urlparse(self.path).query)
                hotwords = query.get("hotwords", [""])[0]
                self.send_json(200, transcribe_wav(wav, hotwords))
        except Exception:
            self.send_json(500, error_payload("transcription_failed", "录音转录失败，请重新录制。", True))

    def create_audio_task(self):
        try:
            data = json.loads(self.read_body(64 * 1024).decode("utf-8"))
            task = AUDIO_TASKS.create(data.get("contentType"), data.get("hotwords"))
            self.send_json(201, task)
        except json.JSONDecodeError:
            self.send_json(400, error_payload("invalid_json", "请求 JSON 格式不正确。"))
        except (ValueError, AudioTaskError) as exc:
            if isinstance(exc, AudioTaskError):
                self.send_json(exc.status, error_payload(exc.code, exc.message))
            else:
                self.send_json(400, error_payload("invalid_request", "录音任务请求不完整。"))

    def complete_audio_task(self, task_id):
        try:
            task = AUDIO_TASKS.submit(task_id)
            threading.Thread(target=process_audio_task, args=(task_id,), daemon=True).start()
            self.send_json(202, task)
        except AudioTaskError as exc:
            self.send_json(exc.status, error_payload(exc.code, exc.message))

    def create_training_card(self):
        try:
            data = json.loads(self.read_body(1024 * 1024).decode("utf-8"))
            self.send_json(200, build_card(data))
        except json.JSONDecodeError:
            self.send_json(400, error_payload("invalid_json", "请求 JSON 格式不正确。"))
        except ValueError:
            self.send_json(400, error_payload("invalid_request", "知识训练请求不完整。"))
        except KnowledgeServiceError as exc:
            self.send_json(exc.status, error_payload(exc.code, exc.message))

    def create_model_connection(self):
        try:
            data = json.loads(self.read_body(64 * 1024).decode("utf-8"))
            connection = MODEL_CONNECTIONS.create(data.get("provider"), data.get("model"), data.get("apiKey"))
            self.send_json(201, connection)
        except json.JSONDecodeError:
            self.send_json(400, error_payload("invalid_json", "请求 JSON 格式不正确。"))
        except (ValueError, ModelConnectionError) as exc:
            if isinstance(exc, ModelConnectionError):
                self.send_json(exc.status, error_payload(exc.code, exc.message, exc.retryable))
            else:
                self.send_json(400, error_payload("invalid_request", "模型连接请求不完整。"))

    def test_model_connection(self, connection_id):
        try:
            settings = MODEL_CONNECTIONS.resolve(connection_id)
            self.send_json(200, test_connection(settings))
        except ModelConnectionError as exc:
            self.send_json(exc.status, error_payload(exc.code, exc.message, exc.retryable))

    def semantic(self):
        try:
            body = self.read_body(1024 * 1024)
        except ValueError as exc:
            self.send_json(400, error_payload("invalid_request", str(exc)))
            return
        try:
            data = json.loads(body.decode("utf-8"))
            connection_id = self.headers.get("X-Model-Connection", "").strip()
            require_byok = os.getenv("EXPRESSION_REQUIRE_BYOK", "true").lower() != "false"
            settings = MODEL_CONNECTIONS.resolve(connection_id) if connection_id else None
            if settings is None and require_byok:
                raise SemanticServiceError("byok_required", "请先接入你自己的模型，再使用 AI 语义分析。", 401)
            result = evaluate_semantic(data, settings=settings)
            print(json.dumps({"event": "semantic_complete", **result.get("_meta", {})}, ensure_ascii=False), flush=True)
            self.send_json(200, result)
        except json.JSONDecodeError:
            self.send_json(400, error_payload("invalid_json", "请求 JSON 格式不正确。"))
        except SemanticServiceError as exc:
            print(json.dumps({"event": "semantic_error", "code": exc.code, "retryable": exc.retryable}, ensure_ascii=False), flush=True)
            self.send_json(exc.status, error_payload(exc.code, exc.message, exc.retryable))
        except ModelConnectionError as exc:
            self.send_json(exc.status, error_payload(exc.code, exc.message, exc.retryable))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=4173)
    parser.add_argument("--web-dir", default="web")
    args = parser.parse_args()
    os.chdir(Path(args.web_dir).resolve())
    if importlib.util.find_spec("funasr") is not None and ffmpeg_path() is not None:
        print("Loading FunASR, VAD and punctuation models...", flush=True)
        load_model()
    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    print(f"P0 expression trainer: http://127.0.0.1:{args.port}/concept-editorial.html?theme=v0", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
