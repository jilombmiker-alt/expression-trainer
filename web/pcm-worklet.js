/* global AudioWorkletProcessor, registerProcessor, sampleRate */
class PcmCapture extends AudioWorkletProcessor {
  constructor() {
    super(); this.phase = 0; this.sum = 0; this.count = 0; this.buffer = [];
    this.port.onmessage = () => { this.flush(); this.port.postMessage({ stopped: true }); };
  }
  flush() {
    if (!this.buffer.length) return;
    const pcm = new ArrayBuffer(this.buffer.length * 2); const view = new DataView(pcm);
    let sum = 0;
    this.buffer.forEach((value, i) => { const v = Math.max(-1, Math.min(1, value)); view.setInt16(i * 2, Math.round(v * 32767), true); sum += v * v; });
    this.port.postMessage({ pcm, rms: Math.sqrt(sum / this.buffer.length) }, [pcm]); this.buffer = [];
  }
  process(inputs) {
    for (const sample of inputs[0]?.[0] || []) {
      this.sum += sample; this.count++; this.phase += 16000;
      if (this.phase >= sampleRate) {
        this.phase -= sampleRate; this.buffer.push(this.sum / this.count); this.sum = 0; this.count = 0;
        if (this.buffer.length === 1600) this.flush();
      }
    }
    return true;
  }
}
registerProcessor('expression-pcm', PcmCapture);
