"""Controlled audio integration check; never proof of a handset microphone."""
import json
import threading
import time
import wave
import sys
from websockets.sync.client import connect

origin = 'https://sm60l23llrvvf6g9a5l98.apigateway-cn-beijing.volceapi.com'
with wave.open(sys.argv[1], 'rb') as wav:
    assert (wav.getnchannels(), wav.getsampwidth(), wav.getframerate()) == (1, 2, 16000)
    pcm = wav.readframes(wav.getnframes())
events = []
started = time.monotonic()
stopped = False
with connect(origin.replace('https:', 'wss:') + '/api/speech/live', origin=origin, open_timeout=15) as ws:
    assert json.loads(ws.recv(timeout=15))['type'] == 'ready'
    def receive():
        while True:
            data = json.loads(ws.recv(timeout=30))
            events.append({'type': data['type'], 'beforeStop': not stopped, 'seconds': round(time.monotonic() - started, 2), 'text': data.get('text', '')})
            if data['type'] in ('final', 'error'):
                return
    reader = threading.Thread(target=receive)
    reader.start()
    for offset in range(0, len(pcm), 3200):
        ws.send(pcm[offset:offset + 3200])
        time.sleep(.1)
    stopped = True
    ws.send(json.dumps({'type': 'stop'}))
    reader.join(timeout=30)
assert any(x['beforeStop'] and x['text'] for x in events), events
assert events[-1]['type'] == 'final' and events[-1]['text'], events
print(json.dumps({'ok': True, 'firstText': next(x for x in events if x['text']), 'final': events[-1]}, ensure_ascii=False))
