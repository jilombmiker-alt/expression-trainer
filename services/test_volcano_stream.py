import gzip
import json
import os
import struct
import tempfile
import unittest
import wave
from pathlib import Path
from volcano_stream import available, auth_headers, initial_request, pack, parse_response, transcribe_wav


class VolcanoProtocolTests(unittest.TestCase):
    def response(self, result, final=False):
        data = gzip.compress(json.dumps({"result": result}).encode())
        return bytes([0x11, 0x93 if final else 0x91, 0x11, 0]) + struct.pack(">iI", -1 if final else 1, len(data)) + data

    def test_no_credentials_fail_closed(self):
        with self.assertRaises(ValueError):
            auth_headers({})

    def test_auth_modes_and_resource_allowlist(self):
        self.assertEqual(auth_headers({"VOLC_ASR_API_KEY": "test-only"})["X-Api-Key"], "test-only")
        self.assertEqual(auth_headers({"VOLC_ASR_APP_ID": "test", "VOLC_ASR_ACCESS_TOKEN": "test-only"})["X-Api-App-Key"], "test")
        with self.assertRaises(ValueError):
            auth_headers({"VOLC_ASR_API_KEY": "test", "VOLC_ASR_RESOURCE_ID": "arbitrary"})

    def test_fillers_are_not_cleaned_or_primed(self):
        body = json.loads(gzip.decompress(initial_request()[8:]))
        self.assertFalse(body["request"]["enable_ddc"])
        self.assertFalse(body["request"]["enable_itn"])
        self.assertNotIn("corpus", body["request"])
        self.assertEqual(body["audio"]["rate"], 16000)

    def test_final_audio_flag(self):
        frame = pack(2, b"\0\0", final=True)
        self.assertEqual(frame[1], 0x22)
        self.assertEqual(gzip.decompress(frame[8:]), b"\0\0")

    def test_full_result_preserves_fillers_and_timestamps(self):
        result = parse_response(self.response({"text": "嗯，第一点。呃，第二点。", "utterances": [
            {"definite": True, "start_time": 0, "end_time": 1000, "text": "第一点"},
            {"definite": True, "start_time": 2100, "end_time": 3000, "text": "第二点"},
            {"definite": False, "start_time": 8000, "end_time": 9000}]}, True))
        self.assertEqual(result["pauses"], [1.1])
        self.assertEqual(result["type"], "final")
        self.assertIn("嗯", result["text"])
        self.assertIsNone(result["confidence"])

    def test_final_result_accepts_timestamps_without_definite_flag(self):
        result = parse_response(self.response({"text": "第一点。第二点。", "utterances": [
            {"start_time": 0, "end_time": 900, "text": "第一点。"},
            {"start_time": 1800, "end_time": 2800, "text": "第二点。"},
        ]}, True))
        self.assertEqual(result["pauses"], [0.9])
        self.assertEqual(len(result["segments"]), 2)

    def test_missing_timestamps_are_disclosed(self):
        result = parse_response(self.response({"text": "只有文字"}, True))
        self.assertEqual(result["segments"], [])
        self.assertIn("暂不计分", result["warning"])

    def test_bad_frames_rejected(self):
        for frame in (b"", b"12345678", self.response({"text": "hello"})[:-1]):
            with self.assertRaises(ValueError):
                parse_response(frame)

    def test_provider_error_is_redacted(self):
        with self.assertRaisesRegex(ValueError, "ASR provider error 45000001"):
            parse_response(bytes([0x11, 0xf0, 0x10, 0]) + struct.pack(">II", 45000001, 6) + b"secret")

    def test_readiness_never_requires_reading_secret_value(self):
        self.assertFalse(available({}))

    def test_wav_transcription_uses_volcano_and_preserves_duration(self):
        response = self.response({"text": "嗯，第一点要先确认目标。", "utterances": [
            {"definite": True, "start_time": 0, "end_time": 900, "text": "嗯，第一点要先确认目标。"}
        ]}, True)

        class Socket:
            def __init__(self): self.sent = []; self.closed = False
            def send(self, frame): self.sent.append(frame)
            def recv(self): return response
            def close(self): self.closed = True

        socket = Socket()
        def connect(*_args, **_kwargs): return socket
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "input.wav"
            with wave.open(str(path), "wb") as target:
                target.setnchannels(1); target.setsampwidth(2); target.setframerate(16000)
                target.writeframes(b"\0\0" * 16000)
            prior = os.environ.get("VOLC_ASR_API_KEY")
            os.environ["VOLC_ASR_API_KEY"] = "test-only"
            try: result = transcribe_wav(path, connect_factory=connect)
            finally:
                if prior is None: os.environ.pop("VOLC_ASR_API_KEY", None)
                else: os.environ["VOLC_ASR_API_KEY"] = prior
        self.assertEqual(result["engine"], "volcano")
        self.assertEqual(result["durationMs"], 1000)
        self.assertTrue(socket.closed)
        self.assertEqual(socket.sent[0][1] >> 4, 1)
        self.assertEqual(socket.sent[-1][1], 0x22)


if __name__ == "__main__":
    unittest.main()
