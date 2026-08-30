import tempfile
import unittest
from pathlib import Path

from audio_tasks import AudioTaskError, AudioTaskStore


WEBM = b"\x1a\x45\xdf\xa3" + b"webm-data"


class AudioTaskStoreTests(unittest.TestCase):
    def test_chunk_order_and_persistent_state(self):
        with tempfile.TemporaryDirectory() as folder:
            store = AudioTaskStore(folder, max_total_bytes=100, max_chunk_bytes=50)
            task = store.create("audio/webm;codecs=opus", ["中心观点"])
            store.add_chunk(task["id"], 0, WEBM)
            submitted = store.submit(task["id"])
            self.assertEqual(submitted["status"], "queued")
            reopened = AudioTaskStore(folder).get(task["id"])
            self.assertEqual(reopened["status"], "failed")
            self.assertTrue(reopened["retryable"])

    def test_out_of_order_chunk_fails_closed(self):
        with tempfile.TemporaryDirectory() as folder:
            store = AudioTaskStore(folder)
            task = store.create("audio/mp4")
            with self.assertRaises(AudioTaskError) as context:
                store.add_chunk(task["id"], 1, b"abc")
            self.assertEqual(context.exception.code, "audio_chunk_out_of_order")

    def test_cancel_cleans_chunks_but_keeps_task_record(self):
        with tempfile.TemporaryDirectory() as folder:
            store = AudioTaskStore(folder)
            task = store.create("audio/webm")
            store.add_chunk(task["id"], 0, WEBM)
            cancelled = store.cancel(task["id"])
            self.assertEqual(cancelled["status"], "cancelled")
            self.assertTrue(Path(folder, task["id"], "task.json").exists())
            self.assertFalse(Path(folder, task["id"], "chunks").exists())

    def test_unknown_audio_type_is_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            with self.assertRaises(AudioTaskError) as context:
                AudioTaskStore(folder).create("text/plain")
            self.assertEqual(context.exception.status, 415)

    def test_declared_audio_type_must_match_real_content(self):
        with tempfile.TemporaryDirectory() as folder:
            store = AudioTaskStore(folder)
            task = store.create("audio/mp4")
            with self.assertRaises(AudioTaskError) as context:
                store.add_chunk(task["id"], 0, WEBM)
            self.assertEqual(context.exception.code, "audio_content_mismatch")

    def test_unrecognized_first_chunk_is_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            store = AudioTaskStore(folder)
            task = store.create("application/octet-stream")
            with self.assertRaises(AudioTaskError) as context:
                store.add_chunk(task["id"], 0, b"not-an-audio-container")
            self.assertEqual(context.exception.code, "audio_content_invalid")


if __name__ == "__main__":
    unittest.main()
