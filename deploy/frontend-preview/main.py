"""Expression Trainer preview host with server-side Volcengine speech proxy."""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit

WEB = Path(__file__).resolve().parent / "web"
SERVICES = Path(__file__).resolve().parent / "services"
sys.path.insert(0, str(SERVICES))
from audio_tasks import detect_audio_type
from volcano_stream import available as volcano_available, transcribe_wav

ASR_SLOTS = threading.BoundedSemaphore(2)
MAX_AUDIO_BYTES = 12 * 1024 * 1024
RATE_LOCK = threading.Lock()
DAILY_SECONDS = {}
MAX_DAILY_SECONDS_PER_CLIENT = 3600


def json_bytes(value):
    return json.dumps(value, ensure_ascii=False).encode("utf-8")


def converter_path():
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


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(WEB), **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "same-origin")
        self.send_header("Permissions-Policy", "microphone=(self), camera=(), geolocation=()")
        super().end_headers()

    def send_json(self, status, payload):
        body = json_bytes(payload)
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def speech_error(self, status, code, message, retryable=False):
        self.send_json(status, {"error": {"code": code, "message": message, "retryable": retryable}})

    def do_GET(self):
        path = unquote(urlsplit(self.path).path)
        if path in ('/downloads/expression-trainer-0.2.0.apk', '/downloads/expression-trainer-0.2.1.apk', '/downloads/expression-trainer-0.2.2.apk'):
            self.send_response(302)
            self.send_header('Location', '/downloads/expression-trainer-0.3.0.apk')
            self.end_headers()
            return
        if path in ("/", "/index.html"):
            self.send_response(302)
            self.send_header("Location", "/welcome.html")
            self.end_headers()
            return
        if path == "/health":
            self.send_json(200, {"status": "ok", "mode": "speech-preview", "cloudTraining": False,
                                 "speech": volcano_available() and converter_path() is not None})
            return
        if path == "/api/speech/health":
            ready = volcano_available() and converter_path() is not None
            self.send_json(200, {"available": ready, "engine": "volcano",
                                 "model": "豆包流式语音识别 2.0",
                                 "capabilities": ["post_recording_transcription"],
                                 "reason": "" if ready else "独立语音服务配置尚未完成"})
            return
        if any(part.startswith(".") for part in path.split("/") if part) or path.startswith("/api/"):
            self.send_error(404)
            return
        super().do_GET()

    def do_POST(self):
        if unquote(urlsplit(self.path).path) != "/api/speech/transcribe":
            self.send_error(404)
            return
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0 or length > MAX_AUDIO_BYTES:
            self.speech_error(413, "audio_size_invalid", "录音为空或超过 12MB，请缩短后重试。")
            return
        if not volcano_available() or converter_path() is None:
            self.speech_error(503, "speech_unavailable", "独立语音服务尚未准备好。", True)
            return
        body = self.rfile.read(length)
        detected = detect_audio_type(body)
        if not detected:
            self.speech_error(415, "audio_content_invalid", "录音格式无法识别，请重新录制。")
            return
        declared = self.headers.get("Content-Type", "").split(";", 1)[0].lower()
        if declared in {"audio/webm", "audio/mp4", "audio/ogg"} and declared != detected:
            self.speech_error(415, "audio_content_mismatch", "录音格式与声明不一致，请重新录制。")
            return
        day_key = time.strftime("%Y-%m-%d", time.gmtime())
        client_key = (day_key, self.client_address[0])
        with RATE_LOCK:
            if DAILY_SECONDS.get(client_key, 0) >= MAX_DAILY_SECONDS_PER_CLIENT:
                self.speech_error(429, "speech_daily_limit", "今日语音测试已达到一小时，请明天继续。")
                return
        if not ASR_SLOTS.acquire(blocking=False):
            self.speech_error(429, "speech_busy", "当前有其他录音正在识别，请稍后再试。", True)
            return
        try:
            suffix = {"audio/webm": ".webm", "audio/mp4": ".mp4", "audio/ogg": ".ogg"}[detected]
            with tempfile.TemporaryDirectory(prefix="expression-asr-") as folder:
                source = Path(folder) / ("input" + suffix)
                wav = Path(folder) / "input.wav"
                source.write_bytes(body)
                subprocess.run([converter_path(), "-loglevel", "error", "-y", "-i", str(source),
                                "-t", "300", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", str(wav)],
                               check=True, timeout=45, capture_output=True)
                result = transcribe_wav(wav)
            seconds = min(300, max(1, int((result.get("durationMs") or 0) / 1000)))
            with RATE_LOCK:
                DAILY_SECONDS[client_key] = DAILY_SECONDS.get(client_key, 0) + seconds
            self.send_json(200, result)
        except subprocess.SubprocessError:
            self.speech_error(415, "audio_decode_failed", "录音解析失败，请重新录制。")
        except TimeoutError:
            self.speech_error(504, "speech_timeout", "语音识别超时，请稍后重试。", True)
        except Exception:
            self.speech_error(502, "speech_provider_failed", "火山语音暂时没有返回结果，请稍后重试。", True)
        finally:
            ASR_SLOTS.release()

    def list_directory(self, path):
        self.send_error(404)
        return None


if __name__ == "__main__":
    from realtime_host import run
    run(Handler, ASR_SLOTS)
