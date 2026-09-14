import math
import struct
import unittest
from audio_pauses import measure_pcm_pauses


def tone(seconds, amplitude=8000):
    return b''.join(struct.pack('<h', int(amplitude * math.sin(i * 2 * math.pi * 220 / 16000))) for i in range(int(seconds * 16000)))


def silence(seconds):
    return bytes(int(seconds * 16000) * 2)


class AudioPauseTests(unittest.TestCase):
    def test_measures_internal_gaps_not_leading_trailing(self):
        pcm = silence(2) + tone(1) + silence(.8) + tone(1) + silence(1.5) + tone(1) + silence(2.5) + tone(1) + silence(3)
        data = measure_pcm_pauses(pcm)
        self.assertTrue(data['available'])
        self.assertEqual([x['durationMs'] for x in data['intervals']], [800, 1500, 2500])

    def test_no_gap_is_different_from_no_audio(self):
        self.assertTrue(measure_pcm_pauses(tone(1))['available'])
        self.assertEqual(measure_pcm_pauses(tone(1))['intervals'], [])
        self.assertFalse(measure_pcm_pauses(silence(2))['available'])

    def test_subthreshold_gaps_and_clicks(self):
        self.assertEqual(measure_pcm_pauses(tone(1) + silence(.3) + tone(1))['intervals'], [])
        self.assertFalse(measure_pcm_pauses(tone(.02))['available'])
