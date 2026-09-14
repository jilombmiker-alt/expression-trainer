(function (root) {
  'use strict';
  function open(callbacks) {
    const session = crypto.randomUUID();
    const native = Boolean(root.ExpressionPcm);
    let ws, context, stream, node, source, timer, finishTimer, nativeTimer, levelTimer, connectionTimer, stopTimer;
    let ended = false, stopping = false, ready = false, started = false, stopSent = false;
    let bytes = 0, peak = 0, lastSound = Date.now(), queue = [];
    function cleanup() {
      clearTimeout(timer); clearTimeout(finishTimer); clearTimeout(nativeTimer); clearTimeout(connectionTimer); clearTimeout(stopTimer); clearInterval(levelTimer);
      root.removeEventListener('expression:pcm', pcmEvent);
      if (native) root.ExpressionPcm.stop();
      node?.disconnect(); source?.disconnect(); stream?.getTracks().forEach(t => t.stop());
      if (context && context.state !== 'closed') void context.close().catch(() => {});
      if (ws && ws.readyState < 2) ws.close(); queue = [];
    }
    function fail(message) { if (ended) return; ended = true; cleanup(); callbacks.error(message); }
    function input(pcm, rms) {
      if (ended || stopSent) return;
      peak = Math.max(peak, rms); bytes += pcm.byteLength;
      if (rms > .005) lastSound = Date.now();
      callbacks.input({ rms, bytes, silent: Date.now() - lastSound > 4000, native });
      if (ready) {
        if (ws.bufferedAmount > 320000) { fail('网络发送积压，已停止录音。已有文字已保留，请检查网络后重试。'); return; }
        ws.send(pcm);
      } else {
        queue.push(pcm);
        if (bytes > 320000) fail('实时连接尚未就绪，已停止录音，请重试。');
      }
    }
    function sendStop() {
      if (ended || stopSent) return;
      if (!ready) { fail('实时连接尚未建立，录音已停止。'); return; }
      clearTimeout(stopTimer); stopSent = true; callbacks.stopping(); ws.send(JSON.stringify({ type: 'stop' }));
      clearInterval(levelTimer);
      finishTimer = setTimeout(() => fail('等待最终文字超时。已有文字已保留，请核对后再试。'), 28000);
    }
    function markStarted() {
      clearTimeout(nativeTimer); if (started) return; started = true; callbacks.started();
      timer = setTimeout(stop, 300000);
      levelTimer = setInterval(() => { if (Date.now() - lastSound > 4000) callbacks.input({ rms: 0, bytes, silent: true, native }); }, 1000);
    }
    function pcmEvent(event) {
      const data = event.detail;
      if (data?.session !== session || ended) return;
      if (data.type === 'ready') markStarted();
      if (data.type === 'data') input(Uint8Array.from(atob(data.audio), c => c.charCodeAt(0)).buffer, Number(data.rms) || 0);
      if (data.type === 'error') fail(data.message);
      if (data.type === 'stopped') { stopping = true; sendStop(); }
    }
    function stop() {
      if (ended || stopping) return;
      stopping = true; clearTimeout(timer);
      stopTimer = setTimeout(() => fail('录音停止确认超时，已有文字已保留，请重新进入训练。'), 3000);
      if (native) root.ExpressionPcm.stop();
      else if (node) node.port.postMessage('flush');
      else sendStop();
    }
    root.addEventListener('expression:pcm', pcmEvent);
    // Invoke synchronously from the user's tap, before any network await.
    if (native) { root.ExpressionPcm.start(session); nativeTimer = setTimeout(() => fail('未收到安卓录音启动确认，请允许麦克风权限后重试。'), 30000); }
    else { context = new AudioContext(); void context.resume().catch(() => fail('无法启动音频采集，请再次点击开始。')); }
    const url = new URL('/api/speech/live', location.href); url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(url); ws.binaryType = 'arraybuffer';
    connectionTimer = setTimeout(() => fail('实时连接建立超时，请检查网络后重试。'), 15000);
    ws.onmessage = async event => {
      try {
        const data = JSON.parse(event.data);
        if (ended) return;
        if (data.type === 'ready') {
          clearTimeout(connectionTimer); ready = true; queue.forEach(pcm => ws.send(pcm)); queue = [];
          if (!native) {
            await context.resume();
            stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
            if (ended) { stream.getTracks().forEach(t => t.stop()); return; }
            await context.audioWorklet.addModule('pcm-worklet.js');
            if (ended) return;
            node = new AudioWorkletNode(context, 'expression-pcm');
            node.port.onmessage = e => { if (e.data.stopped) sendStop(); else input(e.data.pcm, e.data.rms); };
            source = context.createMediaStreamSource(stream); source.connect(node); node.connect(context.destination);
            markStarted();
          }
        } else if (data.type === 'partial' && data.text) callbacks.text(data.text);
        else if (data.type === 'final') {
          if (!data.text?.trim()) { fail(peak < .003 ? `收到 ${Math.round(bytes / 1024)} KB 音频，但音量接近零。请检查系统麦克风隐私开关、耳机与录音占用。` : '已经收到声音，但语音服务没有识别出文字。请靠近麦克风清楚说一句再试。'); return; }
          ended = true; cleanup(); callbacks.final(data);
        } else if (data.type === 'error') fail(data.message);
      } catch (error) {
        const reasons = {NotAllowedError:'未获得麦克风权限，请在浏览器设置中允许录音。',NotFoundError:'未找到可用麦克风，请检查输入设备。',NotReadableError:'麦克风被占用或无法读取，请关闭其他录音应用。',AbortError:'音频采集模块未能加载，请检查网络并重新打开页面。'};
        fail(reasons[error.name] || '实时录音或识别启动失败，请检查麦克风授权后重试。');
      }
    };
    ws.onerror = () => { clearTimeout(connectionTimer); fail('实时连接失败，未连接到语音服务。请检查网络后重试。'); };
    ws.onclose = () => { clearTimeout(connectionTimer); if (!ended) fail('实时连接已断开。已有文字已保留，请重新开始录音。'); };
    return { stop, cancel() { if (!ended) { ended = true; clearTimeout(connectionTimer); cleanup(); } } };
  }
  root.ExpressionRealtime = { open };
})(window);
