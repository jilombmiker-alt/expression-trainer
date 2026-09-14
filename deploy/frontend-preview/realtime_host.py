"""Same-origin duplex ASR transport; existing HTTP routes stay on loopback."""
import asyncio
import json
import os
import threading
import time
from http.server import ThreadingHTTPServer
from aiohttp import web, ClientSession, ClientTimeout, WSMsgType
from websockets.asyncio.client import connect
from volcano_stream import auth_headers, initial_request, pack, parse_response
from audio_pauses import measure_pcm_pauses

PUBLIC_ORIGIN = 'https://sm60l23llrvvf6g9a5l98.apigateway-cn-beijing.volceapi.com'
LIVE_ENDPOINT = 'wss://openspeech.bytedance.com/api/v3/sauc/bigmodel'


def create_app(handler, slots):
    daily_seconds = {}
    async def live(request):
        origin = request.headers.get('Origin', '')
        if origin not in (PUBLIC_ORIGIN, 'http://' + request.host):
            raise web.HTTPForbidden()
        day = time.strftime('%Y-%m-%d', time.gmtime())
        for key in list(daily_seconds):
            if key[0] != day:
                del daily_seconds[key]
        client = (day, request.remote)
        if daily_seconds.get(client, 0) + 300 > 3600:
            raise web.HTTPTooManyRequests(text='今日实时语音测试额度已用完')
        if not slots.acquire(blocking=False):
            raise web.HTTPTooManyRequests(text='语音服务忙，请稍后重试')
        daily_seconds[client] = daily_seconds.get(client, 0) + 300
        started = time.monotonic()
        ws = web.WebSocketResponse(heartbeat=15, max_msg_size=65536)
        pcm = bytearray()
        tasks = []
        try:
            await ws.prepare(request)
            async with connect(LIVE_ENDPOINT, additional_headers=auth_headers(), open_timeout=10, close_timeout=2, max_size=1048576) as upstream:
                await upstream.send(initial_request(realtime=True))
                await ws.send_json({'type': 'ready'})

                async def upload():
                    async for message in ws:
                        if message.type == WSMsgType.BINARY:
                            audio = message.data
                            if len(audio) % 2 or len(pcm) + len(audio) > 9600000:
                                raise ValueError('invalid_audio')
                            pcm.extend(audio)
                            await upstream.send(pack(2, audio))
                        elif message.type == WSMsgType.TEXT and json.loads(message.data).get('type') == 'stop':
                            await upstream.send(pack(2, b'', final=True))
                            return
                        else:
                            raise ValueError('invalid_message')
                    raise ConnectionError('client_closed')

                async def download():
                    async for message in upstream:
                        result = parse_response(message)
                        if result['type'] == 'final':
                            result['durationMs'] = round(len(pcm) / 32)
                            result['pauseMeasurement'] = measure_pcm_pauses(pcm)
                        await ws.send_json(result)
                        if result['type'] == 'final':
                            return
                    raise ConnectionError('provider_closed')

                sender = asyncio.create_task(upload())
                receiver = asyncio.create_task(download())
                tasks = [sender, receiver]
                done, _ = await asyncio.wait(tasks, timeout=310, return_when=asyncio.FIRST_COMPLETED)
                if not done:
                    raise TimeoutError()
                for task in done:
                    task.result()
                if receiver not in done:
                    await asyncio.wait_for(receiver, timeout=25)
        except Exception:
            if ws.prepared and not ws.closed:
                await ws.send_json({'type': 'error', 'message': '实时语音连接中断；已有文字已保留，请重新连接。'})
        finally:
            for task in tasks:
                task.cancel()
            if tasks:
                await asyncio.gather(*tasks, return_exceptions=True)
            pcm.clear()
            daily_seconds[client] = max(0, daily_seconds.get(client, 300) - 300 + min(300, max(1, time.monotonic() - started)))
            slots.release()
            if ws.prepared:
                await ws.close()
        return ws

    async def proxy(request):
        headers = {k: v for k, v in request.headers.items() if k.lower() not in ('host', 'connection', 'transfer-encoding', 'content-length')}
        async with request.app['client'].request(request.method, 'http://127.0.0.1:8001' + request.raw_path,
                                                headers=headers, data=await request.read(), allow_redirects=False) as response:
            payload = await response.read()
            copied = {k: v for k, v in response.headers.items() if k.lower() not in ('connection', 'transfer-encoding', 'content-length', 'content-encoding')}
            if request.path == '/api/speech/health' and response.status == 200:
                data = json.loads(payload)
                data['capabilities'].append('realtime_pcm')
                payload = json.dumps(data).encode()
            return web.Response(status=response.status, body=payload, headers=copied)

    async def resources(app):
        server = ThreadingHTTPServer(('127.0.0.1', 8001), handler)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        async with ClientSession(timeout=ClientTimeout(total=100)) as client:
            app['client'] = client
            yield
        server.shutdown()

    app = web.Application(client_max_size=12 * 1024 * 1024)
    app.cleanup_ctx.append(resources)
    app.router.add_get('/api/speech/live', live)
    app.router.add_route('*', '/{path:.*}', proxy)
    return app


def run(handler, slots):
    web.run_app(create_app(handler, slots), host='0.0.0.0', port=int(os.getenv('PORT', '8000')), access_log=None)
