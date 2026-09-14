package cn.zhishang.expression;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.net.http.SslError;
import android.os.Bundle;
import android.os.Build;
import android.view.View;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import org.json.JSONObject;
import java.util.ArrayList;
import android.webkit.CookieManager;
import android.webkit.HttpAuthHandler;
import android.webkit.PermissionRequest;
import android.webkit.SslErrorHandler;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.EditText;
import android.widget.TextView;
import java.util.Arrays;

/** Thin native permission/navigation layer. Training and visual design remain in the existing web app. */
public final class MainActivity extends Activity {
    private static final int MIC_REQUEST = 41, FILE_REQUEST = 42, NATIVE_MIC_REQUEST = 43, PCM_MIC_REQUEST = 44;
    private PcmRecorder pcmRecorder;
    private String pcmSession = "";
    private boolean pcmPending;
    private SpeechRecognizer recognizer;
    private String speechSession = "";
    private boolean nativePending;
    private WebView web;
    private PermissionRequest pendingMic;
    private ValueCallback<Uri[]> pendingFile;
    private boolean foreground;
    private AlertDialog errorDialog;
    private final Uri trustedOrigin = Uri.parse(BuildConfig.APP_ORIGIN);

    private boolean trusted(Uri uri) {
        if (uri == null || !"https".equals(uri.getScheme()) || uri.getUserInfo() != null) return false;
        int port = uri.getPort() == -1 ? 443 : uri.getPort();
        int expected = trustedOrigin.getPort() == -1 ? 443 : trustedOrigin.getPort();
        return trustedOrigin.getHost().equalsIgnoreCase(uri.getHost()) && port == expected;
    }

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        if (BuildConfig.VALIDATION_ONLY) {
            TextView notice = new TextView(this);
            notice.setText("表达训练器\n\n此包仅验证安卓编译，不是上线版本。\n尚未配置境内 HTTPS 后端，不能进行在线训练。");
            notice.setTextSize(18); notice.setTextColor(0xff202020); notice.setPadding(32, 80, 32, 32);
            setContentView(notice); return;
        }
        web = new WebView(this);
        web.setBackgroundColor(0xfffaf9f6);
        setContentView(web);
        web.setOnApplyWindowInsetsListener((view, insets) -> {
            view.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(),
                insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            return insets;
        });
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true); // Only URIs selected through Android's document picker.
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setUserAgentString(settings.getUserAgentString() + " ExpressionAndroid/0.3.0");
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, false);
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
        web.setDownloadListener((url, userAgent, contentDisposition, mimeType, length) -> {
            Uri target = Uri.parse(url);
            if (!foreground || !trusted(target) || target.getPath() == null || !target.getPath().endsWith(".apk")) return;
            try { startActivity(new Intent(Intent.ACTION_VIEW, target)); }
            catch (RuntimeException unavailable) { showError("请在手机浏览器打开网站，下载安卓测试版。"); }
        });
        web.setWebViewClient(new WebViewClient() {
            @Override public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
                stopPcm(); pcmSession = "";
                cancelSpeech();
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if ("expression-native".equals(uri.getScheme())) {
                    if (!foreground || !request.isForMainFrame() || !trusted(Uri.parse(view.getUrl()))) return true;
                    if ("pcm".equals(uri.getHost())) {
                        if ("/start".equals(uri.getPath()) && request.hasGesture()) {
                            String id = uri.getQueryParameter("session");
                            if (id != null && id.matches("[0-9a-f-]{36}")) beginPcm(id);
                        } else if ("/stop".equals(uri.getPath())) stopPcm();
                        return true;
                    }
                    if ("/start".equals(uri.getPath()) && request.hasGesture()) {
                        String id = uri.getQueryParameter("session");
                        if (id != null && id.matches("[0-9a-f-]{36}")) beginSpeech(id);
                    } else if ("/stop".equals(uri.getPath()) && recognizer != null) recognizer.stopListening();
                    else if ("/cancel".equals(uri.getPath())) cancelSpeech();
                    return true;
                }
                if (trusted(uri)) return false;
                // Never load an external origin in a WebView that holds our microphone permission.
                if (request.isForMainFrame() && request.hasGesture() && ("https".equals(uri.getScheme()) || "http".equals(uri.getScheme()))) {
                    try { startActivity(new Intent(Intent.ACTION_VIEW, uri)); } catch (RuntimeException ignored) { showError("未找到浏览器，请先安装浏览器后重试。"); }
                }
                return true;
            }
            @Override public void onPageFinished(WebView view, String url) {
                if (!trusted(Uri.parse(url))) return;
                view.evaluateJavascript("window.ExpressionPcm={start:function(id){location.href='expression-native://pcm/start?session='+encodeURIComponent(id)},stop:function(){location.href='expression-native://pcm/stop'}};window.dispatchEvent(new Event('expression:pcm-ready'));", null);
                boolean available = SpeechRecognizer.isRecognitionAvailable(MainActivity.this)
                    || (Build.VERSION.SDK_INT >= 31 && SpeechRecognizer.isOnDeviceRecognitionAvailable(MainActivity.this));
                view.evaluateJavascript("window.ExpressionNativeSpeech={available:" + available + ",start:function(id){location.href='expression-native://speech/start?session='+encodeURIComponent(id)},stop:function(){location.href='expression-native://speech/stop'},cancel:function(){location.href='expression-native://speech/cancel'}};window.dispatchEvent(new Event('expression:native-ready'));", null);
            }
            @Override public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
                handler.cancel(); showError("服务器证书无法验证，已停止连接。请联系维护者，不要输入 API Key。");
            }
            @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) showError("暂时连接不到训练服务。请检查网络后重试；已保存在本机的草稿不会主动清除。");
            }
            @Override public void onReceivedHttpAuthRequest(WebView view, HttpAuthHandler handler, String host, String realm) {
                if (!foreground || !trusted(Uri.parse(view.getUrl())) || !trustedOrigin.getHost().equalsIgnoreCase(host)) { handler.cancel(); return; }
                EditText password = new EditText(MainActivity.this);
                password.setInputType(129); password.setHint("内测访问密码（不是 API Key）");
                new AlertDialog.Builder(MainActivity.this).setTitle("进入内测服务").setView(password)
                    .setPositiveButton("进入", (dialog, which) -> { handler.proceed("beta", password.getText().toString()); password.setText(""); })
                    .setNegativeButton("取消", (dialog, which) -> handler.cancel()).setOnCancelListener(dialog -> handler.cancel()).show();
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public void onPermissionRequest(PermissionRequest request) {
                runOnUiThread(() -> {
                    if (!foreground || !trusted(request.getOrigin()) || !trusted(Uri.parse(web.getUrl()))
                        || !Arrays.asList(request.getResources()).contains(PermissionRequest.RESOURCE_AUDIO_CAPTURE)) { request.deny(); return; }
                    cancelMic(); pendingMic = request;
                    if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) grantMic();
                    else requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, MIC_REQUEST);
                });
            }
            @Override public void onPermissionRequestCanceled(PermissionRequest request) { if (pendingMic == request) pendingMic = null; }
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (!trusted(Uri.parse(view.getUrl()))) { callback.onReceiveValue(null); return true; }
                if (pendingFile != null) pendingFile.onReceiveValue(null);
                pendingFile = callback;
                Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*");
                intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE);
                try { startActivityForResult(intent, FILE_REQUEST); }
                catch (RuntimeException error) { pendingFile.onReceiveValue(null); pendingFile = null; showError("系统文件选择器不可用，请使用粘贴文本导入。"); }
                return true;
            }
        });
        web.loadUrl(BuildConfig.APP_ORIGIN + "/welcome.html");
    }

    private void speechEvent(String id, String type, String text, String message) {
        if (web == null || !foreground || !trusted(Uri.parse(web.getUrl()))) return;
        String json = "{session:" + JSONObject.quote(id) + ",type:" + JSONObject.quote(type)
            + ",text:" + JSONObject.quote(text) + ",message:" + JSONObject.quote(message) + "}";
        web.evaluateJavascript("window.dispatchEvent(new CustomEvent('expression:native-speech',{detail:" + json + "}))", null);
    }
    private void stopPcm() {
        pcmPending = false;
        if (pcmRecorder != null) { pcmRecorder.stop(); pcmRecorder = null; }
    }
    private void beginPcm(String id) {
        stopPcm(); cancelSpeech(); pcmSession = id;
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            pcmPending = true; requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, PCM_MIC_REQUEST); return;
        }
        pcmRecorder = new PcmRecorder((type, audio, rms, message) -> runOnUiThread(() -> {
            if (web == null || !foreground || !id.equals(pcmSession) || !trusted(Uri.parse(web.getUrl()))) return;
            String data = "{session:" + JSONObject.quote(id) + ",type:" + JSONObject.quote(type)
                + ",audio:" + JSONObject.quote(audio) + ",rms:" + rms + ",message:" + JSONObject.quote(message) + "}";
            web.evaluateJavascript("window.dispatchEvent(new CustomEvent('expression:pcm',{detail:" + data + "}))", null);
        }));
        pcmRecorder.start();
    }
    private void cancelSpeech() {
        nativePending = false;
        if (recognizer != null) { recognizer.cancel(); recognizer.destroy(); recognizer = null; }
        if (!speechSession.isEmpty()) speechEvent(speechSession, "cancelled", "", "已停止录音，现有文字已保留。");
        speechSession = "";
    }
    private void beginSpeech(String id) {
        if (!id.equals(speechSession)) cancelSpeech();
        else if (recognizer != null) { recognizer.destroy(); recognizer = null; }
        speechSession = id;
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            nativePending = true; requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, NATIVE_MIC_REQUEST); return;
        }
        try {
            if (Build.VERSION.SDK_INT >= 31 && SpeechRecognizer.isOnDeviceRecognitionAvailable(this)) recognizer = SpeechRecognizer.createOnDeviceSpeechRecognizer(this);
            else if (SpeechRecognizer.isRecognitionAvailable(this)) recognizer = SpeechRecognizer.createSpeechRecognizer(this);
            else { speechEvent(id, "error", "", "手机未提供系统识别服务，请使用输入法的语音输入。"); return; }
            recognizer.setRecognitionListener(new RecognitionListener() {
                public void onReadyForSpeech(Bundle params) { speechEvent(id, "ready", "", ""); }
                public void onBeginningOfSpeech() {}
                public void onRmsChanged(float rms) {}
                public void onBufferReceived(byte[] buffer) {}
                public void onEndOfSpeech() { speechEvent(id, "ended", "", ""); }
                public void onError(int error) {
                    String message = error == SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS ? "麦克风权限未允许，请在应用权限中开启。"
                        : error == SpeechRecognizer.ERROR_NO_MATCH || error == SpeechRecognizer.ERROR_SPEECH_TIMEOUT ? "未识别到清晰语音，可以再说一次或使用键盘语音。"
                        : "系统识别服务不可用（" + error + "），已停止重试，请使用键盘语音输入。";
                    speechEvent(id, "error", "", message);
                }
                public void onResults(Bundle results) { emitResult(results, "result"); }
                public void onPartialResults(Bundle results) { emitResult(results, "partial"); }
                private void emitResult(Bundle data, String type) {
                    ArrayList<String> values = data.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
                    speechEvent(id, type, values == null || values.isEmpty() ? "" : values.get(0), "");
                }
                public void onEvent(int eventType, Bundle params) {}
            });
            Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
            intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
            intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, "zh-CN");
            intent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
            recognizer.startListening(intent);
        } catch (RuntimeException failure) { speechEvent(id, "error", "", "系统语音服务启动失败，请使用键盘语音输入。"); }
    }

    private void grantMic() {
        PermissionRequest request = pendingMic; pendingMic = null;
        if (request != null) {
            if (foreground && trusted(Uri.parse(web.getUrl()))) request.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});
            else request.deny();
        }
    }
    private void cancelMic() { if (pendingMic != null) { pendingMic.deny(); pendingMic = null; } }
    @Override public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(requestCode, permissions, results);
        if (requestCode == PCM_MIC_REQUEST && pcmPending) {
            pcmPending = false;
            if (results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED && foreground) beginPcm(pcmSession);
            else if (web != null) web.evaluateJavascript("window.dispatchEvent(new CustomEvent('expression:pcm',{detail:{session:" + JSONObject.quote(pcmSession) + ",type:'error',message:'麦克风权限未允许'}}))", null);
        }
        if (requestCode == NATIVE_MIC_REQUEST && nativePending) {
            nativePending = false;
            if (results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED && foreground) beginSpeech(speechSession);
            else speechEvent(speechSession, "error", "", "未获得麦克风权限，仍可使用键盘或文字练习。");
        }
        if (requestCode == MIC_REQUEST) {
            if (results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED) grantMic();
            else { cancelMic(); showError("麦克风未授权。你仍可用文字练习；开启录音请前往系统设置 → 应用 → 表达训练器 → 权限 → 麦克风。"); }
        }
    }
    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request == FILE_REQUEST && pendingFile != null) {
            pendingFile.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result, data)); pendingFile = null;
        }
    }
    private void showError(String message) {
        if (!foreground || isFinishing() || (errorDialog != null && errorDialog.isShowing())) return;
        errorDialog = new AlertDialog.Builder(this).setTitle("表达训练器").setMessage(message)
            .setPositiveButton("知道了", null).setNeutralButton("重新连接", (dialog, which) -> { if (web != null) web.reload(); }).show();
    }
    @Override protected void onStart() { super.onStart(); foreground = true; }
    private void enterImmersive() {
        if (Build.VERSION.SDK_INT >= 30) {
            getWindow().setDecorFitsSystemWindows(false);
            android.view.WindowInsetsController controller = getWindow().getInsetsController();
            if (controller != null) {
                controller.setSystemBarsBehavior(android.view.WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
                controller.hide(android.view.WindowInsets.Type.systemBars());
            }
        } else {
            getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                | View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
        }
    }
    @Override public void onWindowFocusChanged(boolean focused) { super.onWindowFocusChanged(focused); if (focused) enterImmersive(); }
    @Override protected void onResume() { super.onResume(); if (web != null) { web.onResume(); web.post(this::enterImmersive); } }
    @Override protected void onStop() {
        stopPcm();
        cancelSpeech(); foreground = false; cancelMic();
        if (web != null) {
            web.evaluateJavascript("window.dispatchEvent(new Event('expression:app-background'))", null);
            web.onPause(); CookieManager.getInstance().flush();
        }
        super.onStop();
    }
    @Override public void onBackPressed() {
        if (web != null && web.canGoBack()) web.goBack();
        else new AlertDialog.Builder(this).setTitle("离开训练？").setMessage("正在进行的录音将结束，已保存的草稿会保留。")
            .setPositiveButton("离开", (dialog, which) -> finish()).setNegativeButton("继续训练", null).show();
    }
    @Override protected void onDestroy() {
        stopPcm(); pcmSession = "";
        cancelSpeech(); cancelMic(); if (pendingFile != null) pendingFile.onReceiveValue(null);
        if (web != null) { web.destroy(); web = null; } super.onDestroy();
    }
}
