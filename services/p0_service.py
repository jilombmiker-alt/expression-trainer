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
import time
import wave
from functools import wraps
from http.cookies import SimpleCookie, CookieError
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from semantic_service import SemanticServiceError, evaluate as evaluate_semantic, health as semantic_health, validate_request
from model_connections import (
    ModelConnectionError,
    ModelConnectionStore,
    provider_catalog,
    test_connection,
)
from audio_tasks import AudioTaskError, AudioTaskStore, detect_audio_type
from api_contract import error_payload
from knowledge_service import KnowledgeServiceError, build_card
from training_store import TrainingStore, TrainingError, validate_weights
from analytics_service import summarize
from operator_access import OperatorAccess
from deployment_config import validate_deployment
import sponsored_access as SPONSORED

PROJECT_ROOT = Path(__file__).resolve().parents[1]
SPONSORED.validate(os.environ)
PUBLIC_HOST = validate_deployment(os.environ)
os.environ.setdefault("MODELSCOPE_CACHE", str(PROJECT_ROOT / ".model-cache"))
MODEL = None
MODEL_ERROR = None
MODEL_LOCK = threading.Lock()
INFERENCE_LOCK = threading.Lock()
DATA_ROOT = Path(os.getenv('EXPRESSION_DATA_DIR', str(PROJECT_ROOT / '.p0-data'))).resolve()
AUDIO_TASKS = AudioTaskStore(DATA_ROOT / "audio-tasks")
MODEL_CONNECTIONS = ModelConnectionStore()
TRAINING = TrainingStore(DATA_ROOT / 'training.sqlite3')
ASSESSMENT_SLOTS = threading.BoundedSemaphore(2)
OPERATORS = OperatorAccess()


def api_guard(method):
    @wraps(method)
    def guarded(self):
        self.pending_cookie = None
        self.owner = None
        self.beta_challenge = False
        path = urlparse(self.path).path
        try:
            if PUBLIC_HOST and self.headers.get('Host', '').lower() != PUBLIC_HOST:
                raise TrainingError('host_denied', '请求域名未获允许。', 403)
            if SPONSORED.enabled() and not SPONSORED.authorized(self.headers.get('Authorization')):
                self.beta_challenge = True
                raise TrainingError('beta_access_required', '请输入内测用户名 beta 和维护者提供的内测密码。不要填写 API Key。', 401)
            if path.startswith('/api/'):
                if self.headers.get('Sec-Fetch-Site') not in (None, 'same-origin', 'none'):
                    raise TrainingError('cross_origin_denied', '不允许跨站访问。', 403)
                origin = self.headers.get('Origin')
                if origin and urlparse(origin).netloc != self.headers.get('Host'):
                    raise TrainingError('cross_origin_denied', '不允许跨站访问。', 403)
                self.owner = self.guest_identity(create=path == '/api/session' and self.command == 'GET')
                public = path.endswith('/health') or path == '/api/model-connections/providers'
                if not self.owner and not public:
                    raise TrainingError('session_required', '会话已过期，请刷新页面后重试。', 401)
                parts = path.split('/')
                if path.startswith('/api/audio/tasks/') and len(parts) >= 5:
                    TRAINING.require_resource(self.owner, 'audio', parts[4])
                if path.startswith('/api/model-connections/') and not public:
                    TRAINING.require_resource(self.owner, 'model', parts[3])
            elif self.command == 'GET' and (path.endswith('.html') or path == '/'):
                self.owner = self.guest_identity(create=True)
            return method(self)
        except TrainingError as exc:
            self.send_json(exc.status, error_payload(exc.code, exc.message, exc.status in (409, 429, 503)))
        except (ValueError, TypeError, UnicodeError):
            self.send_json(400, error_payload('invalid_request', '请求内容格式不正确。'))
    return guarded


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
    with wave.open(str(wav), 'rb') as recording:
        duration_ms = round(recording.getnframes() / recording.getframerate() * 1000)
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

    def operator_token(self):
        cookies = SimpleCookie()
        try:
            cookies.load(self.headers.get('Cookie', ''))
        except CookieError:
            return ''
        return cookies['expression_operator'].value if 'expression_operator' in cookies else ''

    def guest_identity(self, create=False):
        cookies = SimpleCookie()
        try:
            cookies.load(self.headers.get('Cookie', ''))
        except Exception:
            cookies = SimpleCookie()
        token = cookies['expression_guest'].value if 'expression_guest' in cookies else ''
        owner = TRAINING.guest(token) if token else None
        if not owner and create:
            token, owner = TRAINING.create_guest()
            self.pending_cookie = f'expression_guest={token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=2592000'
            if os.getenv('EXPRESSION_SECURE_COOKIE') == 'true':
                self.pending_cookie += '; Secure'
        return owner

    def end_headers(self):
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Referrer-Policy', 'no-referrer')
        self.send_header('X-Frame-Options', 'DENY')
        self.send_header('Permissions-Policy', 'microphone=(self), camera=()')
        if getattr(self, 'pending_cookie', None):
            self.send_header('Set-Cookie', self.pending_cookie)
            self.pending_cookie = None
        super().end_headers()

    def log_message(self, format, *args):
        # Never log raw URLs: these may contain BYOK capability IDs or speech hotwords.
        status = str(args[1]) if len(args) > 1 and str(args[1]).isdigit() else '-'
        print(json.dumps({'event': 'http_request', 'method': self.command, 'status': status}), flush=True)

    def send_json(self, status, payload):
        body = json_bytes(payload)
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        if status == 401 and getattr(self, 'beta_challenge', False):
            self.send_header('WWW-Authenticate', 'Basic realm="Expression private beta", charset="UTF-8"')
        if status >= 400:
            self.send_header('Connection', 'close')
            self.close_connection = True
        self.end_headers()
        if self.command != 'HEAD':
            self.wfile.write(body)

    @api_guard
    def do_HEAD(self):
        super().do_HEAD()

    @api_guard
    def do_GET(self):
        path = urlparse(self.path).path
        if path in ('/api/analytics/summary', '/api/admin/analytics'):
            if path.startswith('/api/admin/'):
                OPERATORS.require(self.owner, self.operator_token())
            days = int(parse_qs(urlparse(self.path).query).get('days', ['7'])[0])
            self.send_json(200, summarize(TRAINING, self.owner if path == '/api/analytics/summary' else None, days))
            return
        if path == '/api/privacy':
            self.send_json(200, TRAINING.privacy(self.owner))
            return
        if path == '/api/session':
            self.send_json(200, {'kind': 'guest', 'expiresInDays': 30})
            return
        if path == '/api/training/records':
            self.send_json(200, TRAINING.records(self.owner))
            return
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
            self.send_json(200, {**semantic_health(), 'byokRequired': not SPONSORED.enabled(),
                'billingMode': 'sponsored' if SPONSORED.enabled() else 'byok'})
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

    @api_guard
    def do_POST(self):
        path = urlparse(self.path).path
        if path == '/api/events':
            data = self.read_json(32 * 1024)
            if not TRAINING.privacy(self.owner)['optionalAnalytics']:
                raise TrainingError('analytics_disabled', '当前未开启可选使用分析。', 403)
            self.send_json(200, TRAINING.client_events(self.owner, data.get('events')))
        elif path == '/api/privacy':
            data = self.read_json(2048)
            if type(data.get('optionalAnalytics')) is not bool:
                raise TrainingError('invalid_preference', '请选择是否允许可选使用分析。')
            self.send_json(200, TRAINING.privacy(self.owner, data['optionalAnalytics']))
        elif path == '/api/admin/session':
            data = self.read_json(2048)
            token = OPERATORS.login(self.owner, data.get('accessCode'))
            self.pending_cookie = f'expression_operator={token}; Path=/api/admin; HttpOnly; SameSite=Strict; Max-Age=3600'
            if os.getenv('EXPRESSION_SECURE_COOKIE') == 'true':
                self.pending_cookie += '; Secure'
            self.send_json(200, {'authenticated': True, 'expiresInSeconds': 3600})
        elif path == '/api/training/runs':
            self.create_training_run()
        elif path == '/api/training/attempts':
            data = self.read_json(8192)
            self.send_json(201, TRAINING.start_attempt(self.owner, data.get('trainingId'), data.get('round'), data.get('mode'), data.get('id'), data.get('weights')))
        elif path == '/api/training/assess':
            self.assess_training()
        elif path == "/api/speech/transcribe":
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

    @api_guard
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

    @api_guard
    def do_DELETE(self):
        path = urlparse(self.path).path
        if path == '/api/admin/session':
            OPERATORS.logout(self.operator_token())
            self.pending_cookie = 'expression_operator=; Path=/api/admin; HttpOnly; SameSite=Strict; Max-Age=0'
            self.send_json(200, {'authenticated': False})
            return
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

    def read_json(self, limit):
        data = json.loads(self.read_body(limit))
        if not isinstance(data, dict):
            raise TrainingError('invalid_request', '请求必须是 JSON 对象。')
        return data

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
            data = self.read_json(64 * 1024)
            task = AUDIO_TASKS.create(data.get("contentType"), data.get("hotwords"))
            TRAINING.bind(self.owner, 'audio', task['id'])
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
            data = self.read_json(1024 * 1024)
            started = time.monotonic()
            card = build_card(data)
            TRAINING.server_event(self.owner, 'knowledge_generation_finished', {'method': 'grounded-rule-v1', 'durationMs': round((time.monotonic() - started) * 1000)})
            self.send_json(200, card)
        except json.JSONDecodeError:
            self.send_json(400, error_payload("invalid_json", "请求 JSON 格式不正确。"))
        except ValueError:
            self.send_json(400, error_payload("invalid_request", "知识训练请求不完整。"))
        except KnowledgeServiceError as exc:
            self.send_json(exc.status, error_payload(exc.code, exc.message))

    def create_model_connection(self):
        try:
            data = self.read_json(64 * 1024)
            connection = MODEL_CONNECTIONS.create(data.get("provider"), data.get("model"), data.get("apiKey"))
            TRAINING.bind(self.owner, 'model', connection['connectionId'])
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
            started = time.monotonic()
            result = test_connection(settings)
            TRAINING.server_event(self.owner, 'model_connection_tested', {'provider': settings['provider'], 'result': 'success', 'durationMs': round((time.monotonic() - started) * 1000)})
            self.send_json(200, result)
        except ModelConnectionError as exc:
            TRAINING.server_event(self.owner, 'model_connection_tested', {'result': 'failed', 'errorCode': exc.code})
            self.send_json(exc.status, error_payload(exc.code, exc.message, exc.retryable))

    def semantic(self):
        try:
            body = self.read_body(1024 * 1024)
        except ValueError as exc:
            self.send_json(400, error_payload("invalid_request", str(exc)))
            return
        try:
            data = json.loads(body.decode("utf-8"))
            validate_request(data)
            settings = self.assessment_model()
            if not ASSESSMENT_SLOTS.acquire(blocking=False):
                raise TrainingError('assessment_busy', '分析服务繁忙，请稍后重试。', 503)
            try:
                if SPONSORED.enabled():
                    SPONSORED.consume(TRAINING)
                result = evaluate_semantic(data, settings=settings)
            finally:
                ASSESSMENT_SLOTS.release()
            print(json.dumps({"event": "semantic_complete", **result.get("_meta", {})}, ensure_ascii=False), flush=True)
            self.send_json(200, result)
        except json.JSONDecodeError:
            self.send_json(400, error_payload("invalid_json", "请求 JSON 格式不正确。"))
        except SemanticServiceError as exc:
            print(json.dumps({"event": "semantic_error", "code": exc.code, "retryable": exc.retryable}, ensure_ascii=False), flush=True)
            self.send_json(exc.status, error_payload(exc.code, exc.message, exc.retryable))
        except ModelConnectionError as exc:
            self.send_json(exc.status, error_payload(exc.code, exc.message, exc.retryable))

    def create_training_run(self):
        data = self.read_json(100 * 1024)
        rounds = data.get('rounds')
        if not isinstance(rounds, list) or len(rounds) != 2:
            raise TrainingError('invalid_rounds', '需要同一知识包的两轮材料。')
        try:
            rounds = [validate_request({'exercise': item, 'transcript': '校验材料'})['exercise'] for item in rounds]
        except SemanticServiceError as exc:
            raise TrainingError(exc.code, exc.message, 400) from None
        weights = data.get('weights')
        for round_name in ('first', 'second'):
            chosen = weights.get(round_name) if isinstance(weights, dict) else None
            validate_weights(chosen, round_name)
        self.send_json(201, TRAINING.create_run(self.owner, {'rounds': rounds, 'weights': weights, 'contentVersion': 'registered-v1', 'contentOrigin': 'user-selected'}))

    def assessment_model(self):
        if SPONSORED.enabled():
            return SPONSORED.settings()
        connection_id = self.headers.get('X-Model-Connection', '').strip()
        TRAINING.require_resource(self.owner, 'model', connection_id)
        try:
            return MODEL_CONNECTIONS.resolve(connection_id)
        except ModelConnectionError as exc:
            raise TrainingError(exc.code, exc.message, exc.status) from None

    def assess_training(self):
        data = self.read_json(32 * 1024)
        transcript, timing = data.get('transcript'), data.get('timing')
        if not isinstance(transcript, str) or not 1 <= len(transcript.strip()) <= 5000 or not isinstance(timing, dict):
            raise TrainingError('invalid_answer', '请提供有效转述及计时信息。')
        seconds = timing.get('elapsedSeconds')
        if type(seconds) not in (int, float) or not 0 <= seconds <= 1800:
            raise TrainingError('invalid_timing', '作答时长不正确。')
        # Explicit server policy: host-funded beta OR caller-owned BYOK, never an implicit fallback.
        settings = self.assessment_model()
        if not ASSESSMENT_SLOTS.acquire(blocking=False):
            raise TrainingError('assessment_busy', '分析服务繁忙，请稍后重试。', 503)
        attempt_id = data.get('attemptId')
        reserved = False
        try:
            request = {'transcript': transcript.strip(), 'timing': {'elapsedSeconds': seconds}, 'audioTaskId': data.get('audioTaskId'), 'confirmed': data.get('confirmed') is True}
            attempt, cached = TRAINING.reserve(self.owner, attempt_id, request)
            if cached is not None:
                self.send_json(200, cached)
                return
            reserved = True
            run = TRAINING.run(self.owner, attempt['run_id'])
            exercise = run['rounds'][attempt['round']]
            server_wall = max(0, attempt['submitted'] - attempt['started'])
            elapsed = min(seconds, round(server_wall))
            pauses, asr = [], None
            verified = False
            if request['audioTaskId']:
                TRAINING.require_resource(self.owner, 'audio', request['audioTaskId'])
                task = AUDIO_TASKS.get(request['audioTaskId'])
                if task['status'] != 'completed':
                    raise TrainingError('audio_not_ready', '录音尚未完成，请等待转录。', 409)
                asr = task.get('result') or {}
                if asr.get('needsConfirmation') and not request['confirmed']:
                    raise TrainingError('confirmation_required', '请先核对转录稿。', 409)
                if asr.get('durationMs', 0) > 0:
                    elapsed = round(asr['durationMs'] / 1000)
                    pauses = asr.get('pauses') or []
                    # Task ownership proves origin, not that an uploaded recording was spoken live.
                    verified = True
                asr = {**asr, 'needsConfirmation': False}
            started = time.monotonic()
            fallback_code = None
            try:
                if SPONSORED.enabled():
                    SPONSORED.consume(TRAINING)
                model_assessment = evaluate_semantic({'exercise': exercise, 'transcript': transcript}, settings=settings)
            except SemanticServiceError as exc:
                # A service failure is not a zero-grade answer. Keep the draft and let users retry.
                TRAINING.server_event(self.owner, 'assessment_failed', {'attemptId': attempt_id, 'errorCode': exc.code})
                raise TrainingError(exc.code, exc.message, exc.status) from None
            completed = subprocess.run([os.getenv('EXPRESSION_NODE_PATH', 'node'), str(PROJECT_ROOT / 'services' / 'score_worker.cjs')],
                input=json.dumps({'transcript': transcript, 'exercise': exercise, 'modelAssessment': model_assessment,
                    'round': 'first' if attempt['round'] == 0 else 'second', 'weights': json.loads(attempt['weights']) if attempt.get('weights') else run['weights']['first' if attempt['round'] == 0 else 'second'],
                    'elapsed': elapsed, 'pauses': pauses, 'asr': asr, 'verifiedTiming': verified}),
                text=True, capture_output=True, timeout=10, check=True)
            result = json.loads(completed.stdout)
            result['assessment'] = {'trainingId': attempt['run_id'], 'attemptId': attempt_id, 'round': attempt['round'], 'mode': attempt['mode'],
                'scoringVersion': 'shared-rules-v1', 'contentVersion': run['contentVersion'], 'fallbackCode': fallback_code,
                'timingSource': 'server-audio' if verified else 'client-reported-capped', 'serverWallSeconds': round(server_wall),
                'analysisLatencyMs': round((time.monotonic() - started) * 1000), 'model': model_assessment.get('_meta', {}),
                'gradeEligible': False, 'boundary': '训练反馈记录；材料由用户选入，尚未进行防重放和独立考试验证，不作为正式等级认证。'}
            TRAINING.finish(self.owner, attempt_id, result)
            reserved = False
            self.send_json(200, result)
        except (subprocess.SubprocessError, OSError):
            raise TrainingError('scoring_unavailable', '评分服务暂时不可用；本次不计零分，请稍后重试。', 503) from None
        except AudioTaskError as exc:
            raise TrainingError(exc.code, exc.message, exc.status) from None
        finally:
            if reserved:
                TRAINING.release(self.owner, attempt_id)
            ASSESSMENT_SLOTS.release()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=4173)
    parser.add_argument("--host", default="127.0.0.1", help="默认仅本机；容器内部使用 0.0.0.0，必须由 HTTPS 网关代理")
    parser.add_argument("--web-dir", default="web")
    args = parser.parse_args()
    os.chdir(Path(args.web_dir).resolve())
    if importlib.util.find_spec("funasr") is not None and ffmpeg_path() is not None:
        print("Loading FunASR, VAD and punctuation models...", flush=True)
        load_model()
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    origin = os.getenv('EXPRESSION_PUBLIC_ORIGIN', f'http://{args.host}:{args.port}').rstrip('/')
    print(f"P0 expression trainer: {origin}/concept-editorial.html?theme=v0", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
