"""Volcengine streaming ASR wire codec. No credential or audio logging.

Protocol: https://www.volcengine.com/docs/6561/1354869 (2026-08-06).
Credentials belong to the deployment environment, never a browser or APK.
"""
import gzip
import io
import json
import os
import struct
import threading
import uuid
import wave
from audio_pauses import measure_pcm_pauses

ENDPOINT = "wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async"
RESOURCE_IDS = {"volc.seedasr.sauc.duration", "volc.bigasr.sauc.duration"}
MAX_RESPONSE = 1024 * 1024
MAX_AUDIO_SECONDS = 300


def auth_headers(environ=None):
    env = os.environ if environ is None else environ
    resource = env.get("VOLC_ASR_RESOURCE_ID", "volc.seedasr.sauc.duration")
    if resource not in RESOURCE_IDS:
        raise ValueError("Unsupported ASR resource")
    headers = {"X-Api-Resource-Id": resource, "X-Api-Request-Id": str(uuid.uuid4()),
               "X-Api-Connect-Id": str(uuid.uuid4()), "X-Api-Sequence": "-1"}
    if env.get("VOLC_ASR_API_KEY"):
        headers["X-Api-Key"] = env["VOLC_ASR_API_KEY"]
    elif env.get("VOLC_ASR_APP_ID") and env.get("VOLC_ASR_ACCESS_TOKEN"):
        headers["X-Api-App-Key"] = env["VOLC_ASR_APP_ID"]
        headers["X-Api-Access-Key"] = env["VOLC_ASR_ACCESS_TOKEN"]
    else:
        raise ValueError("Speech credentials are not configured")
    return headers


def pack(message_type, payload, *, final=False, json_payload=False):
    compressed = gzip.compress(payload)
    header = bytes([0x11, (message_type << 4) | (2 if final else 0),
                    (0x10 if json_payload else 0) | 1, 0])
    return header + struct.pack(">I", len(compressed)) + compressed


def initial_request(realtime=False):
    # No document/answer hotwords: don't prime ASR with the expected answer.
    body = {"user": {"uid": str(uuid.uuid4())},
            "audio": {"format": "pcm", "codec": "raw", "rate": 16000, "bits": 16, "channel": 1},
            "request": {"model_name": "bigmodel", "enable_nonstream": not realtime,
                        "enable_itn": False, "enable_ddc": False, "enable_punc": True,
                        "show_utterances": True, "result_type": "full"}}
    return pack(1, json.dumps(body).encode(), json_payload=True)


def parse_response(frame):
    if not isinstance(frame, bytes) or len(frame) < 8 or len(frame) > MAX_RESPONSE:
        raise ValueError("Invalid ASR frame")
    if frame[0] >> 4 != 1:
        raise ValueError("Unsupported ASR protocol")
    offset = (frame[0] & 15) * 4
    kind, flags, encoding, compression = frame[1] >> 4, frame[1] & 15, frame[2] >> 4, frame[2] & 15
    if offset < 4 or offset > len(frame) - 4 or kind not in (9, 15):
        raise ValueError("Invalid ASR header")
    if kind == 15:
        code = struct.unpack_from(">I", frame, offset)[0]
        # Do not surface the provider's raw error (may contain request data).
        raise ValueError("ASR provider error %d" % code)
    if flags & 1:
        offset += 4
    if flags & 4:
        offset += 4
    if offset + 4 > len(frame):
        raise ValueError("Truncated ASR response")
    length = struct.unpack_from(">I", frame, offset)[0]
    payload = frame[offset + 4:]
    if length != len(payload):
        raise ValueError("ASR payload size mismatch")
    if compression == 1:
        with gzip.GzipFile(fileobj=io.BytesIO(payload)) as source:
            payload = source.read(MAX_RESPONSE + 1)
    elif compression != 0:
        raise ValueError("Unsupported ASR compression")
    if len(payload) > MAX_RESPONSE or encoding != 1:
        raise ValueError("Invalid ASR payload")
    body = json.loads(payload)
    if not isinstance(body, dict):
        raise ValueError("Invalid ASR result")
    if body.get("code", 20000000) not in (0, 20000000):
        raise ValueError("ASR returned an unsuccessful result")
    result = body.get("result", {})
    if isinstance(result, list):
        result = result[0] if result else {}
    if not isinstance(result, dict):
        raise ValueError("Invalid ASR result")
    is_final = bool(flags & 2)
    segments = []
    for utterance in result.get("utterances", [])[:500]:
        if not isinstance(utterance, dict):
            continue
        definite = utterance.get("definite")
        if definite is False or (not is_final and definite is not True):
            continue
        start, end = utterance.get("start_time"), utterance.get("end_time")
        if isinstance(start, (int, float)) and isinstance(end, (int, float)) and 0 <= start <= end <= 600000:
            segments.append({"startMs": start, "endMs": end, "text": str(utterance.get("text", ""))[:500]})
    segments.sort(key=lambda item: item["startMs"])
    pauses = [(b["startMs"] - a["endMs"]) / 1000 for a, b in zip(segments, segments[1:])
              if 500 <= b["startMs"] - a["endMs"] <= 20000]
    warning = ("请核对识别文字；分句间隔来自模型时间戳，并不等于全部口语停顿。" if segments
               else "请核对识别文字；本次未返回可用时间戳，停顿指标暂不计分。")
    return {"type": "final" if is_final else "partial", "engine": "volcano",
            "text": str(result.get("text", ""))[:5000], "segments": segments, "pauses": pauses,
            "confidence": None, "needsConfirmation": True,
            "warning": warning}


def available(environ=None):
    """Return a safe readiness result without revealing credentials."""
    env = os.environ if environ is None else environ
    try:
        auth_headers(env)
        import websockets.sync.client  # noqa: F401
    except (ValueError, ImportError):
        return False
    return True


def transcribe_wav(path, *, connect_factory=None, timeout=40):
    """Send a 16 kHz mono PCM WAV to Volcengine and return the final result."""
    if connect_factory is None:
        from websockets.sync.client import connect as connect_factory
    with wave.open(str(path), "rb") as source:
        if (source.getnchannels(), source.getsampwidth(), source.getframerate()) != (1, 2, 16000):
            raise ValueError("ASR input must be 16 kHz mono 16-bit PCM")
        frames = source.getnframes()
        duration_ms = round(frames / 16000 * 1000)
        if duration_ms <= 0 or duration_ms > MAX_AUDIO_SECONDS * 1000:
            raise ValueError("ASR audio duration is outside the supported range")
        pcm = source.readframes(frames)

    connection = connect_factory(
        ENDPOINT,
        additional_headers=auth_headers(),
        open_timeout=10,
        close_timeout=2,
        max_size=MAX_RESPONSE,
    )
    results, errors = [], []
    completed = threading.Event()

    def receive():
        try:
            while not completed.is_set():
                result = parse_response(connection.recv())
                results.append(result)
                if result["type"] == "final":
                    completed.set()
        except Exception as exc:
            errors.append(exc)
            completed.set()

    reader = threading.Thread(target=receive, daemon=True)
    try:
        reader.start()
        connection.send(initial_request())
        packet_bytes = 3200
        chunks = [pcm[offset:offset + packet_bytes] for offset in range(0, len(pcm), packet_bytes)]
        for index, chunk in enumerate(chunks):
            if errors:
                raise errors[0]
            connection.send(pack(2, chunk, final=index == len(chunks) - 1))
        if not completed.wait(timeout):
            raise TimeoutError("ASR provider timed out")
        if errors:
            raise errors[0]
        if not results:
            raise ValueError("ASR provider returned no result")
        final = next((item for item in reversed(results) if item["type"] == "final"), results[-1])
        final["durationMs"] = duration_ms
        final["pauseMeasurement"] = measure_pcm_pauses(pcm)
        return final
    finally:
        completed.set()
        connection.close()
        reader.join(timeout=2)
