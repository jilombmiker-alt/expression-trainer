package cn.zhishang.expression;

import android.media.AudioFormat;
import android.media.AudioRecord;
import android.media.MediaRecorder;
import android.os.Build;
import android.util.Base64;

/** Foreground-only 16 kHz PCM capture. No system recognizer, codec or WebView mic. */
final class PcmRecorder {
    interface Listener { void event(String type, String audio, double rms, String message); }
    private volatile boolean running = true;
    private volatile AudioRecord recorder;
    private final Listener listener;
    PcmRecorder(Listener listener) { this.listener = listener; }
    void start() { new Thread(this::capture, "expression-pcm").start(); }
    void stop() {
        running = false;
        AudioRecord current = recorder;
        if (current != null) try { current.stop(); } catch (RuntimeException ignored) { }
    }
    private void capture() {
        AudioRecord local = null;
        try {
            int minimum = AudioRecord.getMinBufferSize(16000, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT);
            if (minimum < 0) throw new IllegalStateException();
            local = new AudioRecord(MediaRecorder.AudioSource.VOICE_RECOGNITION, 16000,
                AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, Math.max(minimum * 2, 6400));
            recorder = local;
            if (!running) return;
            if (local.getState() != AudioRecord.STATE_INITIALIZED) throw new IllegalStateException();
            local.startRecording();
            listener.event("ready", "", 0, "安卓原生麦克风已开启");
            short[] samples = new short[1600];
            long total = 0;
            while (running && total < 16000L * 300) {
                int count = local.read(samples, 0, samples.length, AudioRecord.READ_BLOCKING);
                if (!running) break;
                if (count < 0) throw new IllegalStateException();
                if (count == 0) continue;
                android.media.AudioRecordingConfiguration config = Build.VERSION.SDK_INT >= 29 ? local.getActiveRecordingConfiguration() : null;
                if (config != null && config.isClientSilenced()) {
                    listener.event("error", "", 0, "系统正在屏蔽录音：请检查麦克风隐私开关，并退出正在通话或录音的其他应用。");
                    break;
                }
                byte[] bytes = new byte[count * 2]; double sum = 0;
                for (int i = 0; i < count; i++) {
                    bytes[i * 2] = (byte) samples[i]; bytes[i * 2 + 1] = (byte) (samples[i] >> 8);
                    sum += (double) samples[i] * samples[i];
                }
                total += count;
                listener.event("data", Base64.encodeToString(bytes, Base64.NO_WRAP), Math.sqrt(sum / count) / 32768, "");
            }
        } catch (SecurityException denied) {
            listener.event("error", "", 0, "没有获得安卓麦克风权限，请在应用权限中允许录音。");
        } catch (RuntimeException failed) {
            if (running) listener.event("error", "", 0, "安卓原生录音启动或读取失败，请退出其他录音应用后重试。");
        } finally {
            running = false; recorder = null;
            if (local != null) { try { local.stop(); } catch (RuntimeException ignored) { } local.release(); }
            listener.event("stopped", "", 0, "");
        }
    }
}
