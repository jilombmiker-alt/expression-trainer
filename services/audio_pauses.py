"""Measure internal low-energy gaps in PCM, not semantic pauses or emotion."""
import array
import math
import sys


def measure_pcm_pauses(pcm, rate=16000):
    samples = array.array('h', pcm)
    if sys.byteorder != 'little':
        samples.byteswap()
    frame = int(rate * .02)
    active = []
    for start in range(0, len(samples), frame):
        part = samples[start:start + frame]
        rms = math.sqrt(sum(x * x for x in part) / max(1, len(part))) / 32768
        active.append(rms >= .01)  # -40 dBFS; reported to the client.
    # Require 100 ms of activity to exclude single clicks from the boundaries.
    runs, begin = [], None
    for i, value in enumerate(active + [False]):
        if value and begin is None:
            begin = i
        if not value and begin is not None:
            if i - begin >= 5:
                runs.append((begin * 20, i * 20))
            begin = None
    gaps = [{'startMs': a[1], 'endMs': b[0], 'durationMs': b[0] - a[1]}
            for a, b in zip(runs, runs[1:]) if b[0] - a[1] >= 500]
    return {'available': bool(runs), 'method': 'pcm-energy-v1',
            'thresholdDbfs': -40, 'minimumMs': 500, 'intervals': gaps,
            'reason': '' if runs else '未检测到足够的有效声音，无法评估间隔。',
            'boundary': '录音内低音量间隔估计；排除开头和结尾等待，噪声及轻声会影响结果，不等于语义停顿。'}
