(function () {
  'use strict';

  const Analyzer = window.ExpressionAnalyzer;
  const Speech = window.ExpressionSpeech;
  const Timing = window.AnswerTiming;
  const Backend = window.TrainingAPI;
  const LiveRecognition = window.LiveRecognition;
  const Calibration = window.MicCalibration;
  const { SETS, countChars, evaluate } = window.WizardContent;
  const Scoring = window.ExpressionScoring;
  const previewStorage = window.ExpressionPreview?.storage;
  const Progress = previewStorage ? { ...window.ExpressionProgress,
    load: () => window.ExpressionProgress.load(previewStorage),
    save: (data) => window.ExpressionProgress.save(data, previewStorage) } : window.ExpressionProgress;
  const Session = previewStorage ? { ...window.TrainingSession,
    load: () => window.TrainingSession.load(previewStorage),
    save: (data) => window.TrainingSession.save(data, previewStorage),
    clear: () => window.TrainingSession.clear(previewStorage) } : window.TrainingSession;
  const AICoach = window.ExpressionAICoach;
  const TrainingCard = window.TrainingCard;
  const app = document.getElementById('editorial-app');
  const stepNames = ['基础测评', '第一轮转述', '训练建议', '30 秒速记', '快速转述', '综合结果'];
  const query = new URLSearchParams(window.location.search);
  const requestedTheme = query.get('theme');
  const knowledgeRequested = query.get('source') === 'knowledge';
  const autoStartRequested = query.get('autostart') === '1';
  const needsAndroidUpgrade = /ExpressionAndroid\/0\.2(?:\s|$)/.test(navigator.userAgent);
  const storedDraft = Session.load();
  const state = {
    step: 0,
    view: 'training',
    maxStep: 0,
    theme: requestedTheme === 'programa' ? 'programa' : 'v0',
    scene: SETS[Math.floor(Math.random() * SETS.length)].id,
    readingSeconds: 180,
    timerId: null,
    timerRemaining: 180,
    timeTicker: null,
    recognition: null,
    recognitionRestartTimer: null,
    recognitionRestartCount: 0,
    recognitionStopReason: null,
    speechIntentActive: false,
    nativeRecording: false, nativeSession: '', nativePrefix: '', nativeRound: 0, nativeRetry: false,
    mediaRecorder: null,
    mediaStream: null,
    recordingLimitTimer: null,
    realtime: null,
    stopInputMonitor: null,
    audioChunks: [],
    audioTaskId: null,
    audioTaskUpload: null,
    audioChunkIndex: 0,
    audioCancelRequested: false,
    audioTaskRound: null,
    speechService: { available: false, engine: 'browser', reason: '正在检测高精度转录服务' },
    asrMeta: [null, null],
    transcriptConfirmed: [false, false],
    transcriptionPending: false,
    microphonePending: false,
    speechHealthPromise: null,
    recording: false,
    sessionStart: 0,
    answerStartedAt: 0,
    answerTiming: null,
    backendRunId: '', backendRunPromise: null, backendGeneration: 0, backendAttemptId: '', backendAttemptKey: '', backendReady: null,
    submittedRequest: null, completedAudioIds: [null, null], readingStartedAt: 0,
    lastResultAt: 0,
    pauseStart: 0,
    pauses: [],
    transcripts: ['', ''],
    results: [null, null],
    retryTranscripts: ['', ''],
    retryResults: [null, null],
    retryMode: null,
    coach: [null, null],
    referenceVisible: [false, false],
    sessionRecorded: false,
    progress: Progress.load(),
    planDraft: null,
    exam: null,
    weights: {
      first: Scoring.cloneWeights(Scoring.DEFAULT_WEIGHTS.first),
      second: Scoring.cloneWeights(Scoring.DEFAULT_WEIGHTS.second)
    },
    weightPreset: { first: 'balanced', second: 'quick' },
    recommendation: null,
    importedSet: null,
    importMessage: '',
    missingKnowledge: false,
    resumeDraft: storedDraft.draft,
    resumeError: storedDraft.error
    ,calibration: { permission: 'unknown', result: null, recorder: null, stream: null, chunks: [], processing: false }
  };

  const icons = {
    mic: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 17a5 5 0 0 0 5-5V7a5 5 0 0 0-10 0v5a5 5 0 0 0 5 5Zm0 0v4m-4 0h8M4 12a8 8 0 0 0 16 0"/></svg>',
    arrow: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>',
    back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>',
    check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>',
    wave: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h2m2-5v10m4-14v18m4-13v8m4-5v2"/></svg>',
    clock: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>'
  };

  app.innerHTML = `
    <div class="wizard-shell">
      <header class="wizard-header">
        <a class="wizard-brand" id="wizard-brand" href="knowledge-studio.html" aria-label="返回知识训练创建页"><span id="brand-mark"></span><div><b>表达训练器</b><small id="brand-subtitle">KNOWLEDGE TRAINING</small></div></a>
        <nav id="step-nav" aria-label="训练进度"></nav>
        <div class="header-tools"><button id="plans-nav" class="utility-nav" type="button">专项计划</button><button id="growth-nav" class="utility-nav" type="button">成长档案</button><button id="theme-switch" class="theme-switch" type="button">切换另一版</button></div>
      </header>
      <main id="main" class="stage-viewport"><section id="stage" class="stage" aria-live="polite"></section></main>
      <footer class="wizard-footer"><a id="exit-training" href="knowledge-studio.html">退出本次训练</a><p id="footer-hint">完成当前步骤后进入下一环节</p><div class="footer-tools"><span id="footer-step">01 / 06</span><a id="settings-link" href="settings.html?theme=v0&section=model">设置</a></div></footer>
    </div>`;

  const stage = document.getElementById('stage');
  const fullscreen = document.createElement('button');
  fullscreen.id = 'fullscreen-toggle'; fullscreen.type = 'button'; fullscreen.textContent = '全屏';
  fullscreen.hidden = /ExpressionAndroid\//.test(navigator.userAgent) || !document.fullscreenEnabled;
  document.querySelector('.footer-tools').prepend(fullscreen);
  fullscreen.addEventListener('click', async () => {
    try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); }
    catch (_) { fullscreen.textContent = '浏览器不支持全屏'; }
  });
  document.addEventListener('fullscreenchange', () => { fullscreen.textContent = document.fullscreenElement ? '退出全屏' : '全屏'; });
  function availableSets() { return state.importedSet ? [...SETS, state.importedSet] : SETS; }
  function activeSet() { return availableSets().find((item) => item.id === state.scene) || SETS[0]; }
  function exercise(roundIndex) { return activeSet().rounds[roundIndex]; }
  function hasModelConnection() { if (Backend.preview || Backend.sponsored()) return true; try { return Boolean(sessionStorage.getItem('expression.modelConnection.v1')); } catch (_) { return false; } }
  function openModelSettings(autoStart = false) {
    const returnUrl = new URL(window.location.href);
    if (autoStart) returnUrl.searchParams.set('autostart', '1');
    else returnUrl.searchParams.delete('autostart');
    try { sessionStorage.setItem('expression.afterModelConnect.v1', `${returnUrl.pathname.split('/').pop()}${returnUrl.search}`); } catch (_) {}
    window.location.href = `settings.html?theme=${state.theme}&section=model&required=1`;
  }
  async function beginSelectedTraining() {
    await Backend.modelAccess;
    if (!hasModelConnection()) { openModelSettings(true); return; }
    resetPractice(); go(1);
  }
  function formatTime(value) { return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`; }
  function escapeHtml(value) { return String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char])); }

  function applyTheme() {
    const programa = state.theme === 'programa';
    document.body.className = programa ? 'training-programa' : 'training-v0';
    document.getElementById('brand-mark').innerHTML = programa
      ? '<svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="10" cy="10" r="5"/><circle cx="10" cy="22" r="5"/><path d="M17 5h10l-7 7h-3zM17 17h10l-7 7h-3z"/></svg>'
      : '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M7 5.5h18v21H7zM11 11h10M11 16h10M11 21h6"/></svg>';
    document.getElementById('brand-subtitle').textContent = programa ? '知识训练' : '/ KNOWLEDGE TRAINING';
    document.getElementById('theme-switch').textContent = programa ? '切换 V0 版 ↗' : '切换 Programa 版 ↗';
    const studioUrl = programa ? 'knowledge-studio-programa.html' : 'knowledge-studio.html';
    document.getElementById('wizard-brand').href = studioUrl;
    document.getElementById('exit-training').href = studioUrl;
    document.getElementById('settings-link').href = `settings.html?theme=${state.theme}&section=model`;
    const url = new URL(window.location.href); url.searchParams.set('theme', state.theme); window.history.replaceState(null, '', url);
  }

  function updateChrome() {
    const inTraining = state.view === 'training';
    document.getElementById('step-nav').innerHTML = stepNames.map((name, index) => {
      const step = index + 1; const status = step === state.step ? 'active' : step < state.step ? 'done' : '';
      const reached = state.step > 0 && step <= state.maxStep;
      return `<button type="button" data-go-step="${step}" class="${status}" aria-current="${step === state.step ? 'step' : 'false'}" ${reached ? '' : 'disabled'}><i>${step < state.step ? icons.check : step}</i><span>${name}</span></button>${step < 6 ? '<em></em>' : ''}`;
    }).join('');
    document.getElementById('step-nav').classList.toggle('view-hidden', !inTraining);
    document.querySelectorAll('[data-go-step]').forEach((button) => button.addEventListener('click', () => go(Number(button.dataset.goStep))));
    document.getElementById('footer-step').textContent = inTraining ? (state.step ? `${String(state.step).padStart(2, '0')} / 06` : '选择内容') : ({ growth: '成长档案', plans: '专项计划', exam: '专项考试' }[state.view]);
    document.getElementById('growth-nav').classList.toggle('active', state.view === 'growth');
    document.getElementById('plans-nav').classList.toggle('active', state.view === 'plans');
  }

  function go(stepNumber) {
    if ([1, 4].includes(state.step) && [2, 5].includes(stepNumber) && state.readingStartedAt) {
      const durationMs = Date.now() - state.readingStartedAt;
      Backend.event('reading_completed', { round: state.step === 1 ? 0 : 1, durationMs: Math.min(durationMs, 600000), endReason: durationMs >= (state.step === 1 ? state.readingSeconds : 30) * 1000 ? 'timeout' : 'manual' });
      state.readingStartedAt = 0;
    }
    stopTimer(); stopRecognition(); state.view = 'training'; state.step = stepNumber; state.maxStep = Math.max(state.maxStep, stepNumber); updateChrome(); render(); persistDraft();
    Backend.event('step_viewed', { step: stepNumber });
  }

  function openView(view) {
    stopTimer(); stopRecognition(); state.view = view; updateChrome(); render();
  }

  function stopTimer() { if (state.timerId) clearInterval(state.timerId); state.timerId = null; }
  function stopRecognition() {
    if (state.realtime) {
      state.realtime.cancel(); state.microphonePending = false; state.transcriptionPending = false;
      const button = document.getElementById('record');
      if (button) { button.disabled = false; button.setAttribute('aria-pressed', 'false'); button.classList.remove('recording'); button.querySelector('b').textContent = '继续实时转录'; }
      const signal = document.getElementById('microphone-signal'); if (signal) signal.hidden = true;
    }
    state.realtime = null;
    state.stopInputMonitor?.(); state.stopInputMonitor = null;
    clearTimeout(state.recordingLimitTimer); state.recordingLimitTimer = null;
    if (state.nativeRecording) { window.ExpressionNativeSpeech?.cancel(); state.nativeRecording = false; state.nativeSession = ''; }
    Timing.stopSpeech(state.answerTiming);
    state.speechIntentActive = false;
    state.recognitionStopReason = 'manual';
    if (state.recognitionRestartTimer) clearTimeout(state.recognitionRestartTimer);
    state.recognitionRestartTimer = null;
    if (state.recognition) { try { state.recognition.stop(); } catch (_) {} }
    if (state.mediaRecorder?.state === 'recording') { state.audioCancelRequested = true; try { state.mediaRecorder.stop(); } catch (_) {} }
    state.mediaStream?.getTracks().forEach((track) => track.stop()); state.mediaStream = null;
    state.recording = false;
    if (state.timeTicker) clearInterval(state.timeTicker);
    state.timeTicker = null;
  }

  function groupedSets() {
    return SETS.reduce((result, set) => {
      if (!result[set.category]) result[set.category] = { label: set.categoryLabel, sets: [] };
      result[set.category].sets.push(set);
      return result;
    }, {});
  }

  function resetPractice() {
    Session.clear(); state.resumeDraft = null; state.resumeError = '';
    state.transcripts = ['', ''];
    state.asrMeta = [null, null]; state.transcriptConfirmed = [false, false];
    state.results = [null, null];
    state.recommendation = null;
    state.retryTranscripts = ['', '']; state.retryResults = [null, null]; state.retryMode = null;
    state.coach = [null, null]; state.referenceVisible = [false, false]; state.sessionRecorded = false;
    state.sessionStart = 0;
    state.answerStartedAt = 0;
    state.answerTiming = null; state.backendRunId = ''; state.backendRunPromise = null;
    state.backendGeneration += 1;
    Backend.context(null);
    state.backendAttemptId = ''; state.backendAttemptKey = ''; state.backendReady = null; state.submittedRequest = null; state.completedAudioIds = [null, null];
    state.maxStep = 0;
    state.audioTaskId = null; state.audioTaskRound = null;
  }

  function persistDraft() { if (state.view === 'training') Session.save(state); }

  function resumeTraining() {
    const draft = state.resumeDraft; if (!draft) return;
    state.step = draft.step; state.maxStep = draft.maxStep; state.scene = draft.scene || state.scene;
    state.readingSeconds = draft.readingSeconds; state.transcripts = draft.transcripts; state.asrMeta = draft.asrMeta;
    state.transcriptConfirmed = draft.transcriptConfirmed; state.results = draft.results; state.weights = draft.weights || state.weights;
    state.weightPreset = draft.weightPreset || state.weightPreset; state.importedSet = draft.importedSet || state.importedSet;
    state.importMessage = draft.importMessage || state.importMessage; state.audioTaskId = draft.audioTaskId; state.audioTaskRound = draft.audioTaskRound;
    state.backendRunId = draft.backendRunId || ''; state.backendAttemptId = draft.backendAttemptId || ''; state.backendAttemptKey = draft.backendAttemptKey || '';
    state.answerTiming = draft.answerTiming || null;
    if (state.answerTiming) state.answerTiming.speechStartedAt = null; // Never count time while the browser was closed.
    state.submittedRequest = draft.submittedRequest || null; state.completedAudioIds = draft.completedAudioIds || [null, null];
    Backend.context(state.backendRunId);
    Backend.event('training_resumed', { step: draft.step });
    state.resumeDraft = null; state.view = 'training'; updateChrome(); render(); persistDraft(); recoverPendingAudioTask();
  }

  async function recoverPendingAudioTask() {
    if (!state.audioTaskId || ![0, 1].includes(state.audioTaskRound)) return;
    const taskId = state.audioTaskId; const roundIndex = state.audioTaskRound;
    state.transcriptionPending = true;
    setVoiceStatus('正在恢复录音任务', '不会重新启动麦克风，正在读取后台进度', 'pending');
    try {
      const task = await Speech.getAudioTask(taskId);
      const result = task.status === 'completed' ? Speech.normalizeResult(task.result || {}) : await Speech.waitForAudioTask(taskId, (value) => setVoiceStatus('正在恢复录音任务', `任务进度 ${value.progress || 0}%`, 'pending'));
      state.transcripts[roundIndex] = result.text; state.asrMeta[roundIndex] = result; state.transcriptConfirmed[roundIndex] = !result.needsConfirmation; state.pauses = result.pauses;
      state.completedAudioIds[roundIndex] = taskId;
      state.audioTaskId = null; state.audioTaskRound = null; persistDraft(); render();
      setVoiceStatus('录音任务已恢复', result.needsConfirmation ? '请核对转录稿后再评分' : '转录与停顿数据已经恢复', result.needsConfirmation ? 'warning' : 'ready');
    } catch (error) {
      const terminal = error.taskStatus === 'failed' || error.taskStatus === 'cancelled' || error.status === 404;
      if (terminal) { state.audioTaskId = null; state.audioTaskRound = null; }
      persistDraft();
      setVoiceStatus(terminal ? '录音任务无法恢复' : '连接暂时中断', terminal ? (error.message || '请重新录制。') : '后台任务可能仍在继续。请稍后刷新，本次任务编号已经保留。', terminal ? 'error' : 'warning');
    } finally { state.transcriptionPending = false; }
  }

  function chooseRandomSet(category) {
    const candidates = SETS.filter((set) => (!category || set.category === category) && set.id !== state.scene);
    const pool = candidates.length ? candidates : SETS;
    state.scene = pool[Math.floor(Math.random() * pool.length)].id;
  }

  function selectionScreen() {
    const groups = groupedSets();
    const current = activeSet();
    const currentCategory = current.id === 'knowledge' ? '__imported__' : current.category;
    const studioUrl = state.theme === 'programa' ? 'knowledge-studio-programa.html' : 'knowledge-studio.html';
    const categoryOptions = `${state.importedSet ? `<option value="__imported__" ${currentCategory === '__imported__' ? 'selected' : ''}>我的导入知识</option>` : ''}${Object.entries(groups).map(([key, group]) => `<option value="${key}" ${key === currentCategory ? 'selected' : ''}>${escapeHtml(group.label)} · ${group.sets.length} 个主题</option>`).join('')}`;
    const topicSets = currentCategory === '__imported__' ? [state.importedSet] : groups[currentCategory].sets;
    const topicOptions = topicSets.map((set) => `<option value="${set.id}" ${set.id === state.scene ? 'selected' : ''}>${escapeHtml(set.packLabel || set.label)}</option>`).join('');
    const resume = state.resumeDraft ? `<div class="resume-draft" role="status"><div><span>发现未完成训练</span><b>上次停在第 ${state.resumeDraft.step} 步 · ${new Date(state.resumeDraft.updatedAt).toLocaleString('zh-CN')}</b></div><button id="discard-draft" class="secondary-button" type="button">放弃草稿</button><button id="resume-draft" class="primary-button" type="button">继续上次训练 ${icons.arrow}</button></div>` : (state.resumeError ? `<p class="draft-error" role="alert">${escapeHtml(state.resumeError)}</p>` : '');
    stage.innerHTML = `
      <div class="selection-heading"><p class="eyebrow">START WITH AN EXAMPLE</p><h1>先选一组内容，直接开始练习。</h1><p>系统已经随机推荐一题。确定后，两轮训练都会围绕同一个知识包进行。</p></div>
      ${resume}
      <div class="selection-layout">
        <article class="selection-preview">
          <header><div><span>${current.id === 'knowledge' ? `我的导入知识${current.sourceRefs?.[0] ? ` · ${escapeHtml(current.sourceRefs[0])}` : ''}` : '本次示例'}</span><h2>${escapeHtml(current.label)}</h2></div><strong>2 轮</strong></header>
          <div><p class="eyebrow">第一轮预览</p><h3>${escapeHtml(current.rounds[0].title)}</h3><p>${escapeHtml(current.rounds[0].central)}</p></div>
          <footer><span>理解转述 · 30 秒至 5 分钟</span><span>快速速记 · 30 秒</span><span>每轮 4 个知识点</span></footer>
        </article>
        <aside class="selection-panel">
          <div><p class="eyebrow">选择训练内容</p><h2>从一个主题开始</h2></div>
          <label for="category-select"><span>训练板块</span><select id="category-select">${categoryOptions}</select></label>
          <label for="topic-select"><span>具体内容</span><select id="topic-select">${topicOptions}</select></label>
          <div class="selection-actions"><button id="random-topic" class="secondary-button" type="button">随机换一组</button><button id="confirm-start" class="primary-button" type="button">开始 ${icons.arrow}</button></div>
          <a class="import-guide" href="${studioUrl}"><span>有自己想学的内容？</span><b>导入文章、课程资料或知识库内容 ${icons.arrow}</b></a>
        </aside>
      </div>`;
    document.getElementById('footer-hint').textContent = '先选内容，再开始训练；导入知识与预训练内容使用同一套流程';
    document.getElementById('category-select').addEventListener('change', (event) => {
      if (event.target.value === '__imported__') state.scene = 'knowledge';
      else chooseRandomSet(event.target.value);
      render();
    });
    document.getElementById('topic-select').addEventListener('change', (event) => { state.scene = event.target.value; render(); });
    document.getElementById('random-topic').addEventListener('click', () => { chooseRandomSet(); render(); });
    document.getElementById('confirm-start').addEventListener('click', beginSelectedTraining);
    document.getElementById('resume-draft')?.addEventListener('click', () => { if (!hasModelConnection()) openModelSettings(); else resumeTraining(); });
    document.getElementById('discard-draft')?.addEventListener('click', () => { Session.clear(); state.resumeDraft = null; render(); });
  }

  function loadSessionKnowledge() {
    try {
      const raw = sessionStorage.getItem('expression.trainingCard');
      if (!raw) { state.missingKnowledge = knowledgeRequested && !state.resumeDraft?.importedSet; return; }
      const payload = JSON.parse(raw); state.importedSet = TrainingCard.normalize(payload.card || payload); state.scene = 'knowledge';
      if (!state.importedSet.sourceRefs?.length && payload.sourceName) state.importedSet.sourceRefs = [String(payload.sourceName).slice(0, 180)];
      if ([30, 60, 90, 120, 150, 180, 210, 240, 300].includes(Number(payload.duration))) state.readingSeconds = Number(payload.duration);
      if (!requestedTheme && (payload.theme === 'programa' || payload.theme === 'v0')) state.theme = payload.theme;
      state.importMessage = `已从网页知识工作台生成“${state.importedSet.label}”。`;
    } catch (_) { state.importMessage = '网页知识训练内容读取失败，请重新创建。'; state.missingKnowledge = knowledgeRequested; }
  }

  function missingKnowledgeScreen() {
    const studioUrl = state.theme === 'programa' ? 'knowledge-studio-programa.html' : 'knowledge-studio.html';
    stage.innerHTML = `<div class="missing-knowledge"><span>KNOWLEDGE NOT FOUND</span><h1>没有读取到刚才导入的知识。</h1><p>训练页不会再擅自回退成“工作汇报”。请回到资料页重新生成，或者明确选择预训练知识。</p><div><a class="primary-button" href="${studioUrl}">重新导入知识 ${icons.arrow}</a><button id="use-prebuilt" class="secondary-button" type="button">改用预训练知识</button></div></div>`;
    document.getElementById('footer-hint').textContent = '用户导入内容缺失时，不使用默认文章替代';
    document.getElementById('use-prebuilt').addEventListener('click', () => { state.missingKnowledge = false; chooseRandomSet(); resetPractice(); go(0); });
  }

  function weightSettings(round) {
    const weights = state.weights[round]; const labels = Scoring.COMPONENTS[round];
    const title = round === 'first' ? (Scoring.FIRST_PRESETS[state.weightPreset.first]?.label || '自定义侧重点') : '快速抓取模型';
    const presets = round === 'first' ? `<div class="weight-presets" role="group" aria-label="选择训练侧重点">${Object.entries(Scoring.FIRST_PRESETS).map(([key, preset]) => `<button type="button" data-weight-preset="${key}" class="${state.weightPreset.first === key ? 'active' : ''}">${preset.label}</button>`).join('')}</div>` : '';
    return `<details class="weight-settings"><summary><span><small>${round === 'first' ? '首次使用先做基础测评，完成后会推荐侧重点' : '中心思想与关键信息合计 50%'}</small><b>${title}</b></span><strong id="weight-total">${Scoring.totalWeight(weights)}%</strong></summary><div class="weight-editor">${presets}<div class="weight-grid">${Object.entries(labels).map(([key, label]) => `<label><span>${label}</span><input type="number" inputmode="numeric" min="0" max="50" step="5" value="${weights[key]}" data-weight-key="${key}" aria-label="${label}权重"><b>%</b></label>`).join('')}</div><p id="weight-help">总权重必须等于 100%。调高某项前，请相应调低其他项目。</p></div></details>`;
  }

  function bindWeightSettings(round) {
    document.querySelectorAll('[data-weight-preset]').forEach((button) => button.addEventListener('click', () => {
      const preset = Scoring.FIRST_PRESETS[button.dataset.weightPreset];
      state.weights.first = Scoring.cloneWeights(preset.weights); state.weightPreset.first = button.dataset.weightPreset; render();
    }));
    document.querySelectorAll('[data-weight-key]').forEach((input) => input.addEventListener('input', () => {
      state.weights[round][input.dataset.weightKey] = Number(input.value);
      state.weightPreset[round] = 'custom';
      const total = Scoring.totalWeight(state.weights[round]); const totalNode = document.getElementById('weight-total'); const help = document.getElementById('weight-help'); const start = document.getElementById('start-timer');
      totalNode.textContent = `${total}%`; totalNode.classList.toggle('invalid', total !== 100);
      help.textContent = total === 100 ? '权重有效，将用于本轮综合评分。' : `当前为 ${total}%，还需要${total < 100 ? `增加 ${100 - total}` : `减少 ${total - 100}`}%。`;
      help.className = total === 100 ? 'valid' : 'invalid'; start.disabled = total !== 100;
    }));
  }

  function readingScreen(roundIndex) {
    const item = exercise(roundIndex); const first = roundIndex === 0;
    const duration = first ? state.readingSeconds : 30;
    stage.innerHTML = `
      <div class="stage-heading">
        <div><p class="eyebrow">环节 ${first ? '一' : '二'} · ${first ? '基础测评' : '短时速记'}</p><h1>${first ? '先理解，不必逐句背诵。' : '30 秒，只抓最关键的信息。'}</h1><p>${first ? '这轮既是训练，也是你的表达基线。完成后系统会建议下一组训练侧重点。' : '这是另一篇文章。时间结束后会自动进入快速转述。'}</p></div>
        <div class="round-badge"><span>ROUND</span><strong>0${roundIndex + 1}</strong></div>
      </div>
      <div class="training-source"><div><span>${state.scene === 'knowledge' ? '我的导入知识' : '当前训练内容'}</span><b>${escapeHtml(activeSet().label)}</b><small>${activeSet().sourceRefs?.[0] ? `来源：${escapeHtml(activeSet().sourceRefs[0])}` : '本知识包同时用于环节一和环节二'}</small></div><button id="change-topic" class="source-change" type="button">重新选题</button></div>
      ${weightSettings(first ? 'first' : 'second')}
      <div class="reading-layout">
        <article class="reading-card">
          <header><div><span>${escapeHtml(activeSet().label)}</span><h2>${escapeHtml(item.title)}</h2></div><div class="word-count"><b>${countChars(item.text)}</b><span>字</span></div></header>
          <p>${escapeHtml(item.text)}</p>
          <footer><span>${first ? '建议先找中心观点，再找 3–4 个信息点' : '只需记住：发生了什么、判断依据、应该怎么做'}</span></footer>
        </article>
        <aside class="reading-control">
          <div class="timer-ring" style="--progress:0"><div>${icons.clock}<span>阅读倒计时</span><strong id="countdown">${formatTime(duration)}</strong></div></div>
          ${first ? `<label for="duration">阅读时限</label><select id="duration">${[30, 60, 90, 120, 150, 180, 210, 240, 300].map((value) => `<option value="${value}" ${value === state.readingSeconds ? 'selected' : ''}>${value === 30 ? '30 秒' : value % 60 ? `${Math.floor(value / 60)} 分半` : `${value / 60} 分钟`}</option>`).join('')}</select>` : '<p class="quick-note">开始后计时 30 秒，时间结束将自动隐藏原文。</p>'}
          <button id="start-timer" class="primary-button" type="button">${first ? '开始阅读' : '开始速记'} ${icons.arrow}</button>
          <button id="finish-reading" class="secondary-button" type="button" hidden>读完，去转述</button>
        </aside>
      </div>`;
    document.getElementById('footer-hint').textContent = first ? '第一轮可选择 30 秒至 5 分钟；到时自动进入转述' : '30 秒结束后自动进入快速转述';
    document.getElementById('change-topic').addEventListener('click', () => { resetPractice(); go(0); });
    if (first) {
      document.getElementById('duration').addEventListener('change', (event) => { state.readingSeconds = Number(event.target.value); document.getElementById('countdown').textContent = formatTime(state.readingSeconds); persistDraft(); });
    }
    bindWeightSettings(first ? 'first' : 'second');
    document.getElementById('start-timer').addEventListener('click', () => startReadingTimer(roundIndex));
    document.getElementById('finish-reading').addEventListener('click', () => go(first ? 2 : 5));
  }

  function startReadingTimer(roundIndex) {
    void ensureBackendRun().catch(() => {});
    state.readingStartedAt = Date.now();
    const total = roundIndex === 0 ? state.readingSeconds : 30; let remaining = total;
    const start = document.getElementById('start-timer'); const finish = document.getElementById('finish-reading'); const select = document.getElementById('duration');
    start.hidden = true; finish.hidden = false; if (select) select.disabled = true;
    document.getElementById('countdown').textContent = formatTime(remaining);
    state.timerId = setInterval(() => {
      remaining -= 1; document.getElementById('countdown').textContent = formatTime(remaining);
      document.querySelector('.timer-ring').style.setProperty('--progress', `${Math.round((1 - remaining / total) * 360)}deg`);
      if (remaining <= 0) go(roundIndex === 0 ? 2 : 5);
    }, 1000);
  }

  function retellScreen(roundIndex) {
    const item = exercise(roundIndex); const retrying = state.retryMode === roundIndex;
    const priorText = retrying ? state.retryTranscripts[roundIndex] : state.transcripts[roundIndex];
    const mode = state.backendAttemptKey === `${roundIndex}-demo` ? 'demo' : retrying ? 'guided' : 'independent';
    const attemptKey = `${roundIndex}-${mode}`;
    if (state.backendAttemptKey !== attemptKey) {
      state.backendAttemptKey = attemptKey; state.backendAttemptId = crypto.randomUUID(); state.backendReady = null;
      state.answerTiming = Timing.create(); state.submittedRequest = null; state.completedAudioIds[roundIndex] = null;
      state.sessionStart = 0; state.answerStartedAt = performance.now(); state.pauses = []; state.pauseStart = 0; state.lastResultAt = 0;
      if (retrying) Backend.event('coach_hint_shown', { round: roundIndex });
    }
    stage.innerHTML = `
      <div class="stage-heading compact">
        <div><p class="eyebrow">${retrying ? 'AI 引导后重说' : `环节 ${roundIndex === 0 ? '一' : '二'} · 重新转述`}</p><h1>${retrying ? '先不给答案，请根据问题重新说一次。' : (roundIndex === 0 ? '现在，不看原文讲给我听。' : '用最少的话，说出最重要的信息。')}</h1><p>${retrying ? escapeHtml(state.coach[roundIndex]?.issues[0]?.question || '重新组织观点后再表达一次。') : (roundIndex === 0 ? '至少表达 15 秒，并讲清一个观点和至少一个原文知识点。' : '至少表达 10 秒；建议在 60 秒内完成，优先保证中心信息准确。')}</p></div>
        <div class="round-badge"><span>ROUND</span><strong>0${roundIndex + 1}</strong></div>
      </div>
      <div class="retell-layout">
        <section class="voice-card">
          ${needsAndroidUpgrade ? '<p role="alert">旧版安装包缺少录音权限，请先<a href="downloads/expression-trainer-0.2.1.apk">下载并覆盖安装 0.2.1</a>，已有练习记录会保留。</p>' : ''}
          <div id="voice-state" class="voice-state" role="status" aria-live="polite"><i></i><div><b>${state.speechService.available ? '火山高精度转录已就绪' : '浏览器转录模式'}</b><span>${state.speechService.available ? `${state.speechService.model || '豆包流式语音识别 2.0'} · 停止录音后生成准确稿` : `${state.speechService.reason || '点击后请求麦克风权限'}；文字输入始终可用`}</span></div><div class="wave-bars" aria-hidden="true">${'<i></i>'.repeat(16)}</div></div>
          <button id="record" class="record-button" type="button" aria-pressed="false"><span>${icons.mic}</span><b>${state.speechService.available ? '开始高精度录音' : '开启麦克风并实时转录'}</b></button>
          <button id="cancel-audio-task" class="cancel-audio-task" type="button" hidden>取消这次录音任务</button>
          <button id="retry-audio" class="keyboard-input" type="button" hidden>重试识别刚才的录音</button>
          <button id="keyboard-input" class="keyboard-input" type="button">使用键盘语音 / 文字</button>
          <p id="microphone-signal" class="microphone-signal" hidden><meter min="0" max="1" value="0" aria-label="麦克风输入音量"></meter><span role="status">正在检查声音输入…</span></p>
          <details class="voice-details"><summary>查看节奏数据与麦克风检查</summary>
          <button id="open-mic-check" class="mic-check-button" type="button">麦克风与停顿校准 <span>先检查再训练</span></button>
          <div class="live-metrics">
            <div><span>表达时长</span><strong id="metric-time">00:00</strong></div>
            <div><span>最近停顿</span><strong id="metric-pause">--</strong></div>
            <div><span>语气 / 填充</span><strong id="metric-filler">0</strong></div>
            <div><span>衔接词</span><strong id="metric-link">0</strong></div>
          </div>
          <div id="pause-stream" class="pause-stream"><span>停顿记录会显示在这里</span></div>
          </details>
        </section>
        <section class="transcript-card">
          <label for="transcript">${state.speechService.available ? '高精度转录稿（停止后生成）' : '浏览器实时转录稿'} <span>识别错误可以直接修改</span></label>
          <textarea id="transcript" rows="9" maxlength="5000" placeholder="${state.speechService.available ? '停止录音后会在这里生成转录稿' : '你说的话会实时显示在这里'}；也可以直接输入文字体验分析……">${escapeHtml(priorText)}</textarea>
          <div class="transcript-bottom"><span id="char-count">${Analyzer.countChineseLike(priorText)} 字</span><button id="fill-demo" type="button">填入示例转述</button></div>
          <div id="asr-confirm" class="asr-confirm" ${state.asrMeta[roundIndex]?.needsConfirmation && !state.transcriptConfirmed[roundIndex] ? '' : 'hidden'}><div><b>请核对转录稿</b><span>${escapeHtml(state.asrMeta[roundIndex]?.warning || '这次识别置信度偏低，错误文字会影响语义评分。')}</span></div><button id="confirm-transcript" type="button">我已核对</button></div>
          <div class="retell-actions"><button id="back-reading" class="secondary-button" type="button">${icons.back} 返回阅读</button><button id="finish-retell" class="primary-button" type="button">完成转述并分析 ${icons.arrow}</button></div>
          <p id="input-error" class="input-error" role="alert"></p>
        </section>
      </div>${calibrationDialog()}`;
    document.getElementById('footer-hint').textContent = state.speechService.available ? '高精度模式在停止录音后生成转录稿；低置信度结果必须人工确认' : '未接通高精度服务，当前使用浏览器识别；文字输入始终可用';
    const area = document.getElementById('transcript');
    area.addEventListener('input', () => { if (retrying) state.retryTranscripts[roundIndex] = area.value; else state.transcripts[roundIndex] = area.value; updateLiveAnalysis(area.value); persistDraft(); });
    document.getElementById('record').addEventListener('click', () => toggleRecording(roundIndex));
    document.getElementById('keyboard-input').addEventListener('click', () => {
      stopRecognition(); document.getElementById('transcript').focus();
      setVoiceStatus('在下方直接表达', '可点手机输入法的麦克风，说话后文字会进入输入框；键盘语音不提供真实停顿数据。', 'ready');
    });
    document.getElementById('cancel-audio-task').addEventListener('click', cancelAudioTask);
    document.getElementById('open-mic-check').addEventListener('click', openCalibrationDialog);
    document.getElementById('fill-demo').addEventListener('click', () => {
      // A demonstrated answer is never independent evidence.
      state.backendAttemptId = crypto.randomUUID(); state.backendReady = null;
      state.backendAttemptKey = `${roundIndex}-demo`; state.submittedRequest = null;
      state.answerTiming = Timing.create(); state.completedAudioIds[roundIndex] = null;
      void prepareBackend(roundIndex, 'demo');
      area.value = buildDemo(item); state.asrMeta[roundIndex] = null; state.transcriptConfirmed[roundIndex] = true; if (retrying) state.retryTranscripts[roundIndex] = area.value; else state.transcripts[roundIndex] = area.value; updateLiveAnalysis(area.value); persistDraft(); area.focus();
    });
    document.getElementById('confirm-transcript')?.addEventListener('click', () => { state.transcriptConfirmed[roundIndex] = true; Backend.event('transcript_confirmed', { round: roundIndex }); document.getElementById('asr-confirm').hidden = true; document.getElementById('input-error').textContent = ''; persistDraft(); });
    document.getElementById('back-reading').addEventListener('click', () => { state.backendAttemptKey = ''; state.backendReady = null; state.submittedRequest = null; if (retrying) { state.retryMode = null; go(roundIndex === 0 ? 3 : 6); } else go(roundIndex === 0 ? 1 : 4); });
    document.getElementById('finish-retell').addEventListener('click', () => finishRetell(roundIndex));
    updateLiveAnalysis(priorText);
    updateNativeSpeechLabel();
    updateRealtimeLabel();
    void prepareBackend(roundIndex, mode);
  }

  async function ensureBackendRun() {
    if (state.backendRunId) {
      if (Backend.preview) Backend.restore(state.backendRunId, activeSet().rounds, state.weights);
      return state.backendRunId;
    }
    const generation = state.backendGeneration;
    if (!state.backendRunPromise) state.backendRunPromise = Backend.create(activeSet().rounds, state.weights);
    try {
      const run = await state.backendRunPromise;
      if (generation !== state.backendGeneration) throw new Error('训练已切换，请重新开始。');
      state.backendRunId = run.id; Backend.context(run.id); persistDraft();
      return run.id;
    } catch (error) {
      if (generation === state.backendGeneration) state.backendRunPromise = null;
      throw error;
    }
  }

  async function prepareBackend(roundIndex, mode) {
    if (state.backendReady) return state.backendReady;
    const attemptId = state.backendAttemptId;
    state.backendReady = (async () => {
      await ensureBackendRun();
      await Backend.start(state.backendRunId, roundIndex, mode, attemptId, state.weights[roundIndex === 0 ? 'first' : 'second']);
      Backend.context(state.backendRunId);
      persistDraft();
      return attemptId;
    })();
    try {
      const id = await state.backendReady;
      const notice = document.getElementById('input-error');
      if (notice?.dataset.source === 'training-setup') { notice.textContent = ''; delete notice.dataset.source; }
      return id;
    }
    catch (error) {
      if (state.backendAttemptId === attemptId) { state.backendReady = null; state.backendRunPromise = null; }
      const notice = document.getElementById('input-error');
      if (notice) { notice.dataset.source = 'training-setup'; notice.textContent = `${error.userMessage || error.message} ${Backend.preview ? '已有文字已保留，请重试。' : '作答已保留；后端未就绪时不会生成正式成绩。'}`; }
      return null;
    }
  }

  function calibrationDialog() {
    return `<div id="mic-check-dialog" class="mic-check-dialog" role="dialog" aria-modal="true" aria-labelledby="mic-check-title" hidden>
      <div class="mic-check-card">
        <header><div><span>VOICE PREFLIGHT</span><h2 id="mic-check-title" tabindex="-1">麦克风与停顿校准</h2></div><button id="close-mic-check" type="button" aria-label="关闭麦克风校准">×</button></header>
        <p class="calibration-lead">先确认权限和高精度服务，再读一段约 20 秒的短句。系统只使用真实时间戳，不会根据文字猜停顿。</p>
        <div class="preflight-grid" id="preflight-grid" aria-live="polite"></div>
        <section class="calibration-script">
          <span>校准短句</span>
          <p>今天我想分享一个简单的方法。<b>停 0.8 秒</b>先确定中心观点。<b>停 1.5 秒</b>再补充关键依据。<b>停 2.5 秒</b>最后给出行动结论。</p>
        </section>
        <div id="calibration-result" class="calibration-result" role="status" aria-live="polite"><p>尚未开始校准。</p></div>
        <footer><button id="recheck-mic" class="secondary-button" type="button">重新检测</button><button id="start-calibration" class="primary-button" type="button">开始校准录音 ${icons.mic}</button></footer>
      </div>
    </div>`;
  }

  async function inspectMicrophone() {
    let permission = 'unknown';
    if (navigator.permissions?.query) {
      try { permission = (await navigator.permissions.query({ name: 'microphone' })).state; } catch (_) { permission = 'unknown'; }
    }
    state.calibration.permission = permission;
    const result = Calibration.permissionState({
      secureContext: window.isSecureContext || ['localhost', '127.0.0.1'].includes(window.location.hostname),
      mediaDevices: Boolean(navigator.mediaDevices?.getUserMedia), permission
    });
    const grid = document.getElementById('preflight-grid');
    if (grid) grid.innerHTML = [
      ['浏览器环境', result.status === 'unsupported' ? '需要处理' : '可使用'],
      ['麦克风权限', result.label],
      ['高精度转录', state.speechService.available ? `已连接 · ${escapeHtml(state.speechService.model || '火山语音')}` : '未连接，仅能使用浏览器模式']
    ].map(([label, value], index) => `<div class="${index === 1 ? result.status : ''}"><span>${label}</span><b>${value}</b></div>`).join('') + `<p class="preflight-action ${result.status}" role="alert">${result.action}</p>`;
    const start = document.getElementById('start-calibration');
    if (start) {
      start.disabled = result.status === 'unsupported' || result.status === 'denied' || !state.speechService.available;
      start.textContent = state.speechService.available ? '开始校准录音' : '需先启动高精度转录服务';
    }
    return result;
  }

  async function openCalibrationDialog() {
    const dialog = document.getElementById('mic-check-dialog');
    dialog.hidden = false;
    document.querySelectorAll('.wizard-header,.wizard-footer,.stage-heading,.retell-layout,.panel-picker').forEach((node) => { node.inert = true; });
    document.getElementById('close-mic-check').onclick = closeCalibrationDialog;
    document.getElementById('recheck-mic').onclick = inspectMicrophone;
    document.getElementById('start-calibration').onclick = toggleCalibrationRecording;
    dialog.onkeydown = (event) => {
      if (event.key === 'Escape') closeCalibrationDialog();
      if (event.key === 'Tab') {
        const targets = [...dialog.querySelectorAll('button:not(:disabled),a[href],input:not(:disabled),[tabindex="0"]')].filter((node) => node.getClientRects().length);
        const first = targets[0]; const last = targets[targets.length - 1];
        if (event.shiftKey && (document.activeElement === first || document.activeElement.id === 'mic-check-title')) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    await inspectMicrophone();
    if (!dialog.hidden && dialog.isConnected) document.getElementById('mic-check-title')?.focus();
  }

  function closeCalibrationDialog() {
    if (state.calibration.recorder?.state === 'recording') state.calibration.recorder.stop();
    state.calibration.stream?.getTracks().forEach((track) => track.stop());
    const dialog = document.getElementById('mic-check-dialog');
    if (dialog) dialog.hidden = true;
    document.querySelectorAll('[inert]').forEach((node) => { node.inert = false; });
    document.getElementById('open-mic-check')?.focus();
  }

  async function toggleCalibrationRecording() {
    const button = document.getElementById('start-calibration');
    const resultBox = document.getElementById('calibration-result');
    if (state.calibration.recorder?.state === 'recording') {
      state.calibration.recorder.stop();
      return;
    }
    try {
      button.disabled = true;
      resultBox.innerHTML = '<p>正在请求麦克风权限…</p>';
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
      state.calibration.permission = 'granted'; state.calibration.stream = stream; state.calibration.chunks = [];
      const preferred = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((type) => MediaRecorder.isTypeSupported?.(type));
      const recorder = preferred ? new MediaRecorder(stream, { mimeType: preferred }) : new MediaRecorder(stream);
      state.calibration.recorder = recorder;
      recorder.ondataavailable = (event) => { if (event.data?.size) state.calibration.chunks.push(event.data); };
      recorder.onstop = async () => {
        state.calibration.processing = true; button.disabled = true; button.textContent = '正在分析停顿';
        stream.getTracks().forEach((track) => track.stop());
        resultBox.innerHTML = '<p>正在读取转录时间戳与停顿…</p>';
        try {
          const blob = new Blob(state.calibration.chunks, { type: recorder.mimeType || 'audio/webm' });
          const transcript = await Speech.transcribe(blob, { hotwords: ['中心观点', '关键依据', '行动结论'] });
          const result = Calibration.evaluate(transcript.pauses); state.calibration.result = result;
          resultBox.className = `calibration-result ${result.status}`;
          resultBox.innerHTML = `<header><b>${result.passed ? '校准通过' : '建议重试'}</b><span>${result.matchedCount} / 3 个目标停顿</span></header><p>${escapeHtml(result.message)}</p><div>${result.matches.map((item) => `<span class="${item.matched ? 'hit' : 'miss'}">目标 ${item.target.toFixed(1)}s · ${item.matched ? `检测 ${item.detected.toFixed(1)}s` : '未命中'}</span>`).join('')}</div><small>识别稿：${escapeHtml(transcript.text || '未获得文字')}</small>`;
        } catch (error) {
          resultBox.className = 'calibration-result retry';
          resultBox.innerHTML = `<header><b>校准未完成</b></header><p>${escapeHtml(error.message || '没有获得可用的时间戳数据。')}</p>`;
        } finally {
          state.calibration.processing = false; button.disabled = false; button.textContent = '重新校准';
          await inspectMicrophone();
        }
      };
      recorder.start(400); button.disabled = false; button.textContent = '正在录音 · 点击停止';
      resultBox.innerHTML = '<p>请按短句朗读，并完成三次指定停顿。</p>';
    } catch (error) {
      const denied = error?.name === 'NotAllowedError' || error?.name === 'SecurityError';
      state.calibration.permission = denied ? 'denied' : 'unknown';
      resultBox.className = 'calibration-result retry';
      resultBox.innerHTML = `<header><b>${denied ? '没有获得麦克风权限' : '麦克风暂时不可用'}</b></header><p>${denied ? '请在地址栏左侧的网站设置中允许麦克风，再点击重新检测。' : '请检查设备是否被其他应用占用，然后重试。'}</p>`;
      button.disabled = false; await inspectMicrophone();
    }
  }

  function buildDemo(item) {
    const names = item.concepts.map((concept) => concept.label);
    const central = item.central.replace(/[。！？!?]+$/, '');
    return `嗯，我理解这段内容主要在讲${central}。第一点是${names[0]}，然后第二点要注意${names[1]}。另外还包括${names[2]}。总的来说，最后需要落实到${names[3]}。`;
  }

  function setVoiceStatus(title, detail, className) {
    const box = document.getElementById('voice-state'); if (!box) return; box.className = `voice-state ${className || ''}`; box.querySelector('b').textContent = title; box.querySelector('span').textContent = detail;
  }

  function updateLiveAnalysis(text) {
    const result = Analyzer.analyze(text); const count = document.getElementById('char-count'); if (count) count.textContent = `${result.charCount} 字`;
    const filler = document.getElementById('metric-filler'); if (filler) filler.textContent = result.counts.fillers;
    const link = document.getElementById('metric-link'); if (link) link.textContent = result.counts.connectors;
  }

  function updateNativeSpeechLabel() {
    if (state.speechService.available || state.recording || state.transcriptionPending || state.microphonePending || !window.ExpressionNativeSpeech?.available || state.nativeRecording || !document.getElementById('record')) return;
    document.querySelector('#record b').textContent = '开始系统语音识别';
    document.querySelector('label[for="transcript"]').firstChild.textContent = '我的转述 ';
    setVoiceStatus('安卓系统语音已就绪', '点击后允许麦克风；系统可能分句返回文字，请核对后提交。', 'ready');
  }
  window.addEventListener('expression:native-ready', updateNativeSpeechLabel);
  function startNativeRecording(roundIndex) {
    state.nativeSession = crypto.randomUUID(); state.nativeRound = roundIndex;
    state.nativeRetry = state.retryMode === roundIndex;
    state.nativePrefix = (state.nativeRetry ? state.retryTranscripts[roundIndex] : state.transcripts[roundIndex]) || '';
    state.nativeRecording = true; state.speechIntentActive = true;
    setVoiceStatus('正在请求安卓语音服务', '首次使用请允许麦克风。设备可能使用系统在线识别服务。', 'pending');
    window.ExpressionNativeSpeech.start(state.nativeSession);
  }
  window.addEventListener('expression:native-speech', (event) => {
    const data = event.detail || {};
    if (!state.nativeRecording || data.session !== state.nativeSession) return;
    const area = document.getElementById('transcript'); const record = document.getElementById('record');
    if (!area || !record) return;
    if (data.type === 'ended') { Timing.stopSpeech(state.answerTiming); setVoiceStatus('正在接收识别结果', '本段录音已停止，等待系统返回文字。', 'pending'); }
    if (data.type === 'ready') {
      Timing.startSpeech(state.answerTiming); state.recording = true;
      state.sessionStart ||= performance.now(); clearInterval(state.timeTicker); state.timeTicker = setInterval(updateSessionTime, 500);
      record.classList.add('recording'); record.setAttribute('aria-pressed', 'true'); record.querySelector('b').textContent = '系统识别中 · 点击结束';
      setVoiceStatus('安卓系统正在听', '部分手机会分句结束；可以再次点击继续，文字不会清空。', 'listening');
    }
    if (data.type === 'partial' || data.type === 'result') {
      area.value = state.nativePrefix + String(data.text || '');
      if (state.nativeRetry) state.retryTranscripts[state.nativeRound] = area.value; else state.transcripts[state.nativeRound] = area.value;
      updateLiveAnalysis(area.value); persistDraft();
    }
    if (['result', 'error', 'cancelled'].includes(data.type)) {
      Timing.stopSpeech(state.answerTiming); state.nativeRecording = false; state.recording = false; state.speechIntentActive = false;
      clearInterval(state.timeTicker); state.timeTicker = null;
      record.classList.remove('recording'); record.setAttribute('aria-pressed', 'false'); record.querySelector('b').textContent = '继续系统语音识别';
      setVoiceStatus(data.type === 'result' ? '本段识别完成，请核对文字' : '系统识别已停止', data.message || '可继续录入下一段，或修改下方文字后提交。', data.type === 'error' ? 'warning' : 'ready');
      persistDraft();
    }
  });
  async function toggleRecording(roundIndex) {
    if (state.microphonePending || state.transcriptionPending) return;
    if (state.realtime) { state.realtime.stop(); return; }
    if (window.ExpressionPcm || state.speechService.capabilities?.includes('realtime_pcm')) {
      if (/ExpressionAndroid\//.test(navigator.userAgent) && !window.ExpressionPcm) {
        setVoiceStatus('请更新实时录音安装包', '当前安装包没有原生实时收音接口，请从首页下载 0.3.0 覆盖安装。', 'warning'); return;
      }
      startRealtimeRecording(roundIndex); return;
    }
    if (needsAndroidUpgrade) { setVoiceStatus('请先更新安卓安装包', '点击上方下载链接，覆盖安装 0.2.1 后即可使用麦克风。', 'warning'); return; }
    if (state.nativeRecording) { window.ExpressionNativeSpeech.stop(); return; }
    if (state.recording || state.speechIntentActive) {
      Timing.stopSpeech(state.answerTiming);
      if (state.mediaRecorder?.state === 'recording') state.mediaRecorder.stop();
      else if (state.recognition) {
        state.speechIntentActive = false;
        Backend.event('asr_finished', { engine: 'browser', durationMs: Math.min(state.answerTiming?.speechMs || 0, 3600000) });
        state.recognitionStopReason = 'manual';
        if (state.recognitionRestartTimer) clearTimeout(state.recognitionRestartTimer);
        state.recognitionRestartTimer = null;
        try { state.recognition.stop(); } catch (_) {}
      }
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) { setVoiceStatus('当前环境不能调用麦克风', '请使用下方的键盘语音或文字输入', 'error'); return; }
    const record = document.getElementById('record');
    let stream = null;
    try {
      state.microphonePending = true;
      record.disabled = true;
      if (!state.speechService.available) {
        setVoiceStatus('正在连接语音服务', '连接完成后会请求麦克风权限', 'pending');
        await checkSpeechService();
        if (state.speechService.capabilities?.includes('realtime_pcm')) {
          state.microphonePending = false; record.disabled = false;
          setVoiceStatus('实时语音已连接', '请再次点击开始，允许麦克风后即可实时转录。', 'ready'); return;
        }
      }
      if (!record.isConnected) return;
      const cloudReady = state.speechService.available && typeof window.MediaRecorder === 'function';
      if (!cloudReady && window.ExpressionNativeSpeech?.available) { startNativeRecording(roundIndex); return; }
      if (!cloudReady && state.browserSpeechUnavailable) { setVoiceStatus('暂时连接不到语音服务', '请检查网络后再次点击录音；已有文字会保留。也可以使用文字输入。', 'warning'); return; }
      record.disabled = true; setVoiceStatus('正在请求麦克风权限', '请在浏览器提示中选择允许', 'pending');
      stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
      if (document.hidden || !record.isConnected) { stream.getTracks().forEach((track) => track.stop()); setVoiceStatus('录音未开始', '请回到训练页面后重新点击录音', 'warning'); return; }
      Backend.event('microphone_permission_resolved', { result: 'granted' });
      if (state.speechService.available && window.MediaRecorder) { await startHighAccuracyRecording(stream, roundIndex); return; }
      stream.getTracks().forEach((track) => track.stop());
      const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!Recognition) { state.browserSpeechUnavailable = true; setVoiceStatus('当前浏览器不提供语音识别', '麦克风权限不等于识别服务可用。请点“使用键盘语音 / 文字”。', 'warning'); return; }
      state.pauses = []; state.pauseStart = 0; state.lastResultAt = 0; state.sessionStart = performance.now();
      state.speechIntentActive = true; state.recognitionRestartCount = 0; state.recognitionStopReason = null;
      const retrying = state.retryMode === roundIndex;
      const currentText = retrying ? state.retryTranscripts[roundIndex] : state.transcripts[roundIndex];
      let committed = currentText ? `${currentText} ` : '';
      state.recognition = new Recognition(); state.recognition.lang = 'zh-CN'; state.recognition.continuous = true; state.recognition.interimResults = true;
      // Browser callbacks include network latency; they are not acoustic pause timestamps.
      state.recognition.onresult = (event) => {
        state.recognitionRestartCount = 0;
        state.lastResultAt = performance.now();
        let interim = '';
        for (let i = event.resultIndex; i < event.results.length; i += 1) { const value = event.results[i][0].transcript; if (event.results[i].isFinal) committed += value; else interim += value; }
        const area = document.getElementById('transcript'); area.value = committed + interim; if (retrying) state.retryTranscripts[roundIndex] = area.value; else state.transcripts[roundIndex] = area.value; updateLiveAnalysis(area.value); updateSessionTime();
      };
      state.recognition.onerror = (event) => {
        const failure = LiveRecognition.classifyError(event.error);
        if (failure.code === 'network' || failure.code === 'service-not-allowed') {
          state.browserSpeechUnavailable = true; state.speechIntentActive = false; state.recognitionStopReason = 'error';
          Timing.stopSpeech(state.answerTiming); state.recording = false;
          clearInterval(state.timeTicker); state.timeTicker = null;
          record.classList.remove('recording'); record.setAttribute('aria-pressed', 'false'); record.querySelector('b').textContent = '浏览器语音不可用';
          setVoiceStatus('浏览器未能连接识别服务', '已停止反复重试。请用下方键盘语音输入；安卓包可尝试系统识别。', 'warning');
          persistDraft(); return;
        }
        if (failure.fatal) {
          state.speechIntentActive = false; state.recognitionStopReason = 'error'; state.recording = false;
          if (state.timeTicker) clearInterval(state.timeTicker); state.timeTicker = null;
          record.classList.remove('recording'); record.setAttribute('aria-pressed', 'false'); record.querySelector('b').textContent = '重新尝试实时转录';
          const permission = ['not-allowed', 'service-not-allowed'].includes(failure.code);
          setVoiceStatus(permission ? '麦克风或语音识别未获允许' : '当前麦克风不可用', permission ? '请在浏览器网站设置中允许麦克风后重试' : '请检查麦克风是否被其他应用占用', 'error');
          return;
        }
        setVoiceStatus('识别连接短暂中断', failure.code === 'no-speech' ? '暂时没有检测到说话，正在保持监听' : '系统正在自动恢复，不需要重新点击', 'warning');
      };
      state.recognition.onend = () => {
        Timing.stopSpeech(state.answerTiming);
        state.recording = false;
        const decision = LiveRecognition.decideEnd({ intentActive: state.speechIntentActive, stopReason: state.recognitionStopReason, restartCount: state.recognitionRestartCount, maxRestarts: 1 });
        if (decision.action === 'restart') {
          Backend.event('asr_interrupted', { reason: 'network' });
          state.recognitionRestartCount = decision.nextRestartCount;
          record.classList.add('recording'); record.setAttribute('aria-pressed', 'true'); record.querySelector('b').textContent = '识别中断 · 正在自动恢复';
          setVoiceStatus('正在恢复实时转录', `第 ${decision.nextRestartCount} 次自动恢复；你可以继续说话或点击结束`, 'pending');
          state.recognitionRestartTimer = setTimeout(() => {
            state.recognitionRestartTimer = null;
            if (!state.speechIntentActive) return;
            try {
              state.recognition.start(); Timing.startSpeech(state.answerTiming); state.recording = true; record.querySelector('b').textContent = '正在转录 · 点击结束';
              setVoiceStatus('正在听你说话', '实时转录已经恢复', 'listening');
            } catch (_) {
              state.speechIntentActive = false; state.recognitionStopReason = 'error'; record.classList.remove('recording'); record.setAttribute('aria-pressed', 'false'); record.querySelector('b').textContent = '重新尝试实时转录';
              setVoiceStatus('实时转录恢复失败', '当前浏览器识别服务不稳定，请重新点击或改用文字输入', 'error');
            }
          }, decision.delayMs);
          return;
        }
        state.speechIntentActive = false;
        if (state.timeTicker) clearInterval(state.timeTicker); state.timeTicker = null;
        record.classList.remove('recording'); record.setAttribute('aria-pressed', 'false');
        record.querySelector('b').textContent = state.browserSpeechUnavailable ? '浏览器语音不可用' : decision.reason === 'exhausted' ? '重新尝试实时转录' : '继续实时转录';
        if (decision.reason === 'exhausted') { state.browserSpeechUnavailable = true; setVoiceStatus('浏览器识别服务没有稳定响应', '已停止自动重试，输入内容仍保留。请用键盘语音输入，或安装安卓测试版。', 'warning'); }
        else if (decision.reason !== 'error') setVoiceStatus('转录已暂停', '检查识别稿后可以继续或进入分析', 'ready');
        persistDraft();
      };
      state.recognition.start(); Timing.startSpeech(state.answerTiming); state.recording = true; record.classList.add('recording'); record.setAttribute('aria-pressed', 'true'); record.querySelector('b').textContent = '正在转录 · 点击结束'; setVoiceStatus('正在听你说话', '请核对下方文字；浏览器识别不提供可靠停顿数据', 'listening');
      state.timeTicker = setInterval(updateSessionTime, 500);
    } catch (error) {
      state.speechIntentActive = false; state.recognitionStopReason = 'error';
      stream?.getTracks().forEach((track) => track.stop());
      const permissionDenied = ['NotAllowedError', 'PermissionDeniedError'].includes(error?.name);
      Backend.event('microphone_permission_resolved', { result: permissionDenied ? 'denied' : 'unavailable' });
      setVoiceStatus(
        permissionDenied ? '没有获得麦克风权限' : error?.name === 'NotReadableError' ? '麦克风暂时无法启动' : '录音服务暂时不可用',
        permissionDenied
          ? (/ExpressionAndroid\//.test(navigator.userAgent) ? '请在手机设置 → 应用 → 表达训练器 → 权限中允许麦克风，再点击录音。' : '请在浏览器网站设置中允许麦克风，再点击录音；也可以直接输入文字。')
          : error?.name === 'NotReadableError' ? '请结束其他应用的录音或通话后重试；安卓安装包请更新到 0.2.1 或更高版本。' : '请检查网络和麦克风后重试，已有文字会保留。',
        'error',
      );
    }
    finally { state.microphonePending = false; record.disabled = false; }
  }

  function updateRealtimeLabel() {
    if (!state.speechService.capabilities?.includes('realtime_pcm') || state.recording || state.realtime) return;
    const record = document.getElementById('record'); if (!record) return;
    record.querySelector('b').textContent = '开始实时转录';
    document.querySelector('label[for="transcript"]').firstChild.textContent = '实时转录稿 ';
    document.getElementById('transcript').placeholder = '说话时文字会持续出现在这里，结束后可核对修改。';
    setVoiceStatus('火山实时转录已就绪', '点击开始，说话时即可看到文字。', 'ready');
  }
  window.addEventListener('expression:pcm-ready', updateRealtimeLabel);

  function startRealtimeRecording(roundIndex) {
    const record = document.getElementById('record'); const area = document.getElementById('transcript');
    const prefix = area.value.trim(); const prior = state.asrMeta[roundIndex];
    const signal = document.getElementById('microphone-signal'); signal.hidden = false;
    const retrying = state.retryMode === roundIndex;
    let wrote = false;
    const write = text => {
      if (!area.isConnected) return;
      state.asrMeta[roundIndex] = null; state.transcriptConfirmed[roundIndex] = false;
      area.value = [prefix, text].filter(Boolean).join('\n'); wrote = true;
      if (retrying) state.retryTranscripts[roundIndex] = area.value; else state.transcripts[roundIndex] = area.value;
      updateLiveAnalysis(area.value); persistDraft();
    };
    const reset = () => {
      Timing.stopSpeech(state.answerTiming); clearInterval(state.timeTicker); state.timeTicker = null;
      state.recording = false; state.microphonePending = false; state.transcriptionPending = false; state.realtime = null;
      record.disabled = false; record.setAttribute('aria-pressed', 'false'); record.classList.remove('recording'); record.querySelector('b').textContent = '继续实时转录'; signal.hidden = true; persistDraft();
    };
    state.microphonePending = true; record.disabled = true;
    setVoiceStatus('正在连接实时语音', '首次使用请允许麦克风权限。', 'pending');
    state.realtime = window.ExpressionRealtime.open({
      started() {
        state.microphonePending = false; state.recording = true; record.disabled = false;
        Timing.startSpeech(state.answerTiming); state.sessionStart = performance.now(); state.timeTicker = setInterval(updateSessionTime, 500);
        record.setAttribute('aria-pressed', 'true'); record.classList.add('recording'); record.querySelector('b').textContent = '实时转录中 · 点击结束';
        setVoiceStatus('正在实时转录', '请开始说话，文字会持续显示；停顿后可能修正上一句。', 'listening');
      },
      input(data) {
        signal.querySelector('meter').value = Math.min(1, data.rms * 8);
        signal.querySelector('span').textContent = data.silent ? '暂未收到有效声音，请检查系统麦克风隐私开关及其他录音应用。' : `已采集 ${Math.round(data.bytes / 1024)} KB 音频 · ${data.native ? '安卓原生收音' : '网页收音'}`;
      },
      text: write,
      stopping() { Timing.stopSpeech(state.answerTiming); state.transcriptionPending = true; record.disabled = true; setVoiceStatus('正在确认最后一句', '已显示的文字会保留。', 'pending'); },
      final(data) {
        const result = Speech.normalizeResult(data); write(result.text);
        const measurement = result.pauseMeasurement;
        const offset = prior?.durationMs || 0;
        if (measurement && prior) measurement.intervals = [...(prior.pauseMeasurement?.intervals || []), ...measurement.intervals.map(x => ({...x,startMs:x.startMs+offset,endMs:x.endMs+offset}))];
        state.asrMeta[roundIndex] = { ...result, text: area.value, durationMs: offset + result.durationMs };
        state.transcriptConfirmed[roundIndex] = false;
        state.pauses = measurement?.available ? measurement.intervals.map(x => x.durationMs / 1000) : result.pauses;
        renderPauseData(); document.getElementById('asr-confirm').hidden = false;
        reset(); setVoiceStatus('实时转录完成', '请核对识别文字后进入分析。', 'ready');
      },
      error(message) {
        if (wrote) { state.asrMeta[roundIndex] = {text:area.value,needsConfirmation:true,warning:'录音中断，当前文字可能不完整，请核对。'}; state.transcriptConfirmed[roundIndex] = false; document.getElementById('asr-confirm').hidden = false; }
        reset(); setVoiceStatus('实时转录未完成', message, 'error');
      }
    });
  }

  function monitorMicrophone(stream) {
    state.stopInputMonitor?.();
    const node = document.getElementById('microphone-signal');
    if (!node) return;
    node.hidden = false;
    const meter = node.querySelector('meter'); const label = node.querySelector('span');
    let context; let source; let timer; let stopped = false;
    const started = performance.now(); let lastSignal = null;
    const show = (text, status) => { if (label.textContent !== text) label.textContent = text; node.dataset.signal = status; };
    state.stopInputMonitor = () => {
      stopped = true; clearInterval(timer); source?.disconnect();
      if (context && context.state !== 'closed') void context.close().catch(() => {});
      meter.value = 0; node.hidden = true;
    };
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      context = new AudioContext();
      const analyser = context.createAnalyser(); analyser.fftSize = 1024;
      source = context.createMediaStreamSource(stream); source.connect(analyser);
      // Input diagnostic only: never treat an amplitude threshold as speech,
      // pause evidence or scoring. Do not connect to speakers (feedback).
      const samples = new Float32Array(analyser.fftSize);
      void context.resume().catch(() => {});
      const sample = () => {
        if (stopped) return;
        if (context.state !== 'running') { show('音量检测暂不可用；说完请点击停止并转录。', 'unavailable'); return; }
        analyser.getFloatTimeDomainData(samples);
        const rms = Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);
        meter.value = Math.min(1, rms * 8);
        const now = performance.now();
        if (rms > 0.005) lastSignal = now;
        if (lastSignal !== null && now - lastSignal < 1500) show('已收到声音 · 说完点击停止并转录', 'sound');
        else if (now - (lastSignal ?? started) > 4000) show('暂未检测到声音，请检查麦克风是否静音或被遮挡。', 'silent');
        else show('正在听，请对着麦克风说话…', 'listening');
      };
      timer = setInterval(sample, 150); sample();
    } catch (_) { show('音量检测暂不可用；说完请点击停止并转录。', 'unavailable'); }
  }

  async function startHighAccuracyRecording(stream, roundIndex) {
    const record = document.getElementById('record'); const retrying = state.retryMode === roundIndex;
    const targetArea = document.getElementById('transcript');
    const retryButton = document.getElementById('retry-audio');
    if (retryButton) retryButton.hidden = true;
    state.mediaStream = stream; state.audioChunks = []; state.pauses = []; state.sessionStart = performance.now(); state.transcriptionPending = false; state.audioCancelRequested = false;
    const preferred = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((type) => MediaRecorder.isTypeSupported?.(type));
    state.mediaRecorder = preferred ? new MediaRecorder(stream, { mimeType: preferred }) : new MediaRecorder(stream);
    const item = exercise(roundIndex); const hotwords = item.concepts.flatMap((concept) => [concept.label, ...(concept.terms || [])]).slice(0, 24);
    const chunked = Boolean(state.speechService.chunkedTasks);
    if (chunked) {
      const task = await Speech.createAudioTask(state.mediaRecorder.mimeType || 'audio/webm', hotwords);
      state.audioTaskId = task.id; state.audioTaskRound = roundIndex; state.audioChunkIndex = 0; state.audioTaskUpload = Promise.resolve(); persistDraft();
      document.getElementById('cancel-audio-task').hidden = false;
    }
    state.mediaRecorder.ondataavailable = (event) => {
      if (!event.data?.size) return;
      if (!chunked) { state.audioChunks.push(event.data); return; }
      const index = state.audioChunkIndex; state.audioChunkIndex += 1;
      state.audioTaskUpload = state.audioTaskUpload.then(() => Speech.uploadAudioChunk(state.audioTaskId, index, event.data));
    };
    const recorder = state.mediaRecorder;
    recorder.onerror = () => { setVoiceStatus('录音设备中断', '请检查麦克风，已录制部分会在停止后尝试识别。', 'warning'); };
    const completeRecording = async () => {
      state.stopInputMonitor?.(); state.stopInputMonitor = null;
      Timing.stopSpeech(state.answerTiming);
      clearInterval(state.timeTicker); state.timeTicker = null;
      clearTimeout(state.recordingLimitTimer); state.recordingLimitTimer = null;
      stream.getTracks().forEach((track) => track.stop());
      if (!record.isConnected || state.audioCancelRequested) {
        state.recording = false; state.transcriptionPending = false;
        record.disabled = false; record.classList.remove('recording'); record.setAttribute('aria-pressed', 'false'); record.querySelector('b').textContent = '继续高精度录音';
        if (chunked && state.audioTaskId) { try { await Speech.cancelAudioTask(state.audioTaskId); } catch (_) {} }
        return;
      }
      state.recording = false; state.transcriptionPending = true; record.disabled = true; record.classList.remove('recording'); record.querySelector('b').textContent = '正在生成高精度转录稿';
      record.setAttribute('aria-pressed', 'false');
      if (retryButton) retryButton.hidden = true;
      setVoiceStatus('正在识别录音', '请稍等，识别完成后文字会显示在下方', 'pending');
      try {
        let result;
        if (chunked) {
          await state.audioTaskUpload;
          if (state.audioCancelRequested) {
            await Speech.cancelAudioTask(state.audioTaskId);
            setVoiceStatus('本次录音已取消', '没有生成转录，也不会计入评分', 'warning');
            return;
          }
          await Speech.completeAudioTask(state.audioTaskId);
          result = await Speech.waitForAudioTask(state.audioTaskId, (task) => {
            const labels = { queued: '等待识别', converting: '正在转换音频', transcribing: '正在生成转录' };
            if (task.frontendState === 'disconnected') setVoiceStatus('连接暂时中断', '后台任务未必停止，正在自动恢复进度查询', 'warning');
            else setVoiceStatus(labels[task.status] || '正在处理录音', `任务进度 ${task.progress || 0}% · 页面中断后仍可恢复`, 'pending');
            persistDraft();
          });
        } else {
          const blob = new Blob(state.audioChunks, { type: recorder.mimeType || 'audio/webm' });
          if (!blob.size) throw new Error('没有录到音频，请检查麦克风后重新录制');
          result = await Speech.transcribe(blob, { hotwords });
        }
        const area = document.getElementById('transcript');
        if (!area || area !== targetArea || state.audioCancelRequested) return;
        if (!result.text.trim()) throw new Error('没有识别到清晰语音，请检查麦克风是否静音');
        state.completedAudioIds[roundIndex] = chunked ? state.audioTaskId : null;
        Backend.event('asr_finished', { engine: result.engine || 'volcano', durationMs: Math.min(result.durationMs || 0, 3600000) });
        area.value = [area.value.trim(), result.text].filter(Boolean).join('\n');
        const previous = state.asrMeta[roundIndex];
        state.asrMeta[roundIndex] = { ...result, text: area.value, durationMs: (previous?.durationMs || 0) + result.durationMs, pauses: [...(previous?.pauses || []), ...result.pauses] };
        if (result.pauseMeasurement || previous?.pauseMeasurement) {
          const offset = previous?.durationMs || 0;
          const current = result.pauseMeasurement;
          const prior = previous?.pauseMeasurement;
          state.asrMeta[roundIndex].pauseMeasurement = {
            ...(current || prior), available: current?.available === true && (!previous || prior?.available === true),
            intervals: [...(prior?.intervals || []), ...(current?.intervals || []).map(x => ({ ...x, startMs: x.startMs + offset, endMs: x.endMs + offset }))]
          };
        }
        state.transcriptConfirmed[roundIndex] = !result.needsConfirmation; state.pauses = state.asrMeta[roundIndex].pauses;
        if (retrying) state.retryTranscripts[roundIndex] = area.value; else state.transcripts[roundIndex] = area.value;
        updateLiveAnalysis(area.value); renderPauseData(); persistDraft();
        const confirm = document.getElementById('asr-confirm'); if (confirm) confirm.hidden = !result.needsConfirmation;
        if (confirm) confirm.querySelector('span').textContent = result.warning || '请核对识别文字后再进入分析。';
        state.audioChunks = [];
        setVoiceStatus('高精度转录完成', result.warning || '文字已追加，请核对后进入分析。', result.needsConfirmation ? 'warning' : 'ready');
      } catch (error) {
        if (record.isConnected) {
          const retained = !chunked && state.audioChunks.some((blob) => blob.size);
          if (retryButton) retryButton.hidden = !retained;
          setVoiceStatus('这次识别没有完成', `${error.userMessage || error.message}${retained ? '。录音暂存在当前页面，可点击重试；刷新页面会清除录音。' : '。已有文字已保留，可以重新录音。'}`, 'error');
        }
      }
      finally { state.transcriptionPending = false; state.audioTaskId = null; state.audioTaskRound = null; state.audioTaskUpload = null; state.audioCancelRequested = false; persistDraft(); record.disabled = false; record.querySelector('b').textContent = '继续高精度录音'; const cancel = document.getElementById('cancel-audio-task'); if (cancel) cancel.hidden = true; }
    };
    recorder.onstop = completeRecording;
    if (retryButton) retryButton.onclick = () => { if (!state.recording && !state.transcriptionPending) void completeRecording(); };
    state.mediaRecorder.start(chunked ? 5000 : 400); Timing.startSpeech(state.answerTiming); state.recording = true; record.disabled = false; record.classList.add('recording'); record.setAttribute('aria-pressed', 'true'); record.querySelector('b').textContent = '正在录音 · 点击停止并转录'; setVoiceStatus('正在录音', '说完后点击停止，文字会自动显示在下方；单次最长 5 分钟。', 'listening'); state.timeTicker = setInterval(updateSessionTime, 500);
    monitorMicrophone(stream);
    state.recordingLimitTimer = setTimeout(() => { if (recorder.state === 'recording') recorder.stop(); }, 300000);
  }

  async function cancelAudioTask() {
    state.audioCancelRequested = true;
    const button = document.getElementById('cancel-audio-task'); if (button) { button.disabled = true; button.textContent = '正在取消…'; }
    if (state.mediaRecorder?.state === 'recording') state.mediaRecorder.stop();
    else if (state.audioTaskId) {
      try { await Speech.cancelAudioTask(state.audioTaskId); setVoiceStatus('本次录音已取消', '没有生成转录，也不会计入评分', 'warning'); }
      catch (_) { setVoiceStatus('取消失败', '请稍后重试，或刷新页面后恢复任务', 'error'); }
    }
  }

  function updateSessionTime() {
    const node = document.getElementById('metric-time'); if (!node || !state.sessionStart) return; node.textContent = formatTime(Math.floor((performance.now() - state.sessionStart) / 1000));
  }

  function renderPauseData() {
    const latest = state.pauses[state.pauses.length - 1]; const metric = document.getElementById('metric-pause'); if (metric) metric.textContent = latest ? `${latest.toFixed(1)}s` : '--';
    const stream = document.getElementById('pause-stream'); if (stream) stream.innerHTML = state.pauses.length ? state.pauses.slice(-6).map((value) => `<span class="${value >= 2 ? 'long' : ''}">${value.toFixed(1)}s</span>`).join('') : '<span>未检测到 0.5 秒以上停顿</span>';
  }

  async function finishRetell(roundIndex) {
    const retrying = state.retryMode === roundIndex;
    const text = retrying ? state.retryTranscripts[roundIndex] : state.transcripts[roundIndex];
    if (!Analyzer.countChineseLike(text)) { document.getElementById('input-error').textContent = '请先完成转述。空白作答不能进入评分。'; document.getElementById('transcript').focus(); return; }
    if (state.recording || state.speechIntentActive || state.transcriptionPending) { document.getElementById('input-error').textContent = '请先停止录音，并等待转录完成。'; return; }
    if (state.asrMeta[roundIndex]?.needsConfirmation && !state.transcriptConfirmed[roundIndex]) { document.getElementById('input-error').textContent = '这份转录需要先核对并确认，否则识别错误会污染评分。'; document.getElementById('confirm-transcript')?.focus(); return; }
    stopRecognition(); clearInterval(state.timeTicker);
    const button = document.getElementById('finish-retell'); button.disabled = true; button.textContent = '正在分析语义关系…';
    // Freeze BEFORE any HTTP or model wait. The same payload is retried after ambiguous failures.
    const timing = Timing.freeze(state.answerTiming || (state.answerTiming = Timing.create()));
    try {
      const attemptId = await prepareBackend(roundIndex, retrying ? 'guided' : 'independent');
      if (!attemptId) return;
      if (!state.submittedRequest) state.submittedRequest = { attemptId, transcript: text, timing, audioTaskId: state.completedAudioIds[roundIndex], confirmed: state.transcriptConfirmed[roundIndex] };
      if (Backend.preview) state.submittedRequest.asr = state.asrMeta[roundIndex];
      persistDraft();
      const result = await Backend.assess(state.submittedRequest);
      if (retrying) {
        state.retryResults[roundIndex] = result; state.referenceVisible[roundIndex] = false; state.retryMode = null;
      } else {
        state.results[roundIndex] = result; state.coach[roundIndex] = AICoach.diagnose(result, exercise(roundIndex), roundIndex);
        if (roundIndex === 0) state.recommendation = result.scoring.invalid ? null : Scoring.recommendFirst(result, exercise(0));
      }
      go(roundIndex === 0 ? 3 : 6);
    } catch (error) {
      const notice = document.getElementById('input-error');
      if (notice) notice.textContent = `${error.userMessage || error.message} 本次未记分；再次点击将重试已提交的原作答。`;
    } finally {
      button.disabled = false; button.textContent = '完成转述并分析';
    }
  }

  function oralAdvice(result) {
    const advice = [];
    if (result.oral.counts.fillers) advice.push(`把“${result.oral.groups.fillers.slice(0, 2).map((item) => item.term).join('、')}”替换成约 0.8 秒的安静停顿。`);
    if (result.longestPause >= 3) advice.push('最长停顿超过 3 秒，建议在开口前先确定下一句的关键词。');
    if (result.pace > 260) advice.push('当前语速偏快，重点观点后可以停半秒，让听者完成理解。');
    if (result.oral.counts.connectors) advice.push(`识别到 ${result.oral.counts.connectors} 次衔接词。逐句检查“但是”前后是否真的相反；并列信息用“另外”，原因用“因为”，不用为了衔接而添加转折。`);
    if (result.oral.counts.hedges) advice.push(`识别到 ${result.oral.counts.hedges} 次犹豫表达。把已确定的事实与尚不确定的判断分开；先说事实，再说明不确定的依据。`);
    if (result.oral.cleanliness.repetitions.length) advice.push('发现连续重复。重说时先在心里确定主语和动作，每句话只启动一次；卡住时停一下，再说完整句。');
    if (!result.pauseEvidence?.available) advice.push('本次没有可用的录音间隔证据。下一次请用页面录音完成一段话；文字输入和旧记录不能补算停顿。');
    advice.push('做一次 30 秒重说：先给一个观点，再给一个理由，最后补一个例子。说完对比填充词次数和遗漏信息，不必照背标准答案。');
    if (!advice.length) advice.push('口语习惯较稳定。下一轮重点让每个分点只表达一个意思。');
    return advice;
  }

  function scoreBreakdown(result, round) {
    const labels = Scoring.COMPONENTS[round];
    return `<div class="score-breakdown">${Object.entries(result.scoring.weights).map(([key, weight]) => `<div><span>${labels[key]}<small>${weight}%</small></span><b>${Number.isFinite(result.scoring.components[key]) ? result.scoring.components[key] : '--'}</b></div>`).join('')}</div>`;
  }

  function targetedDrills(result) {
    const drills = {
      oralControl: { title: '静默替代训练', text: '再次表达同一段内容。想说“嗯、那个、就是”时，改成 0.8 秒安静停顿。', target: '目标：每 100 字无效填充词不超过 1 次' },
      pauseRhythm: { title: '语义分组停顿', text: '先用斜线把句子切成意思完整的小组；组内不停，组间停 0.6–1.2 秒，结论前停 1.5 秒。', target: '目标：减少 3 秒以上的卡顿' },
      connectorLogic: { title: '关系词替换训练', text: '每个衔接词都要回答一种关系：并列、转折、因果或结论。不能说明关系的“然后”直接删除。', target: '目标：衔接词少而准确，不重复堆叠' },
      semanticConciseness: { title: '三词一语训练', text: '先写下 3 个关键词，再用“一个中心句 + 三个信息点”重述，最后删掉不改变意思的句子。', target: '目标：信息保留，字数比原文减少 30%–60%' }
    };
    const keys = ['oralControl', 'pauseRhythm', 'connectorLogic', 'semanticConciseness']
      .filter((key) => Number.isFinite(result.scoring.components[key]))
      .sort((a, b) => result.scoring.components[a] - result.scoring.components[b])
      .slice(0, 2);
    return keys.map((key) => `<article><span>针对性训练</span><h3>${drills[key].title}</h3><p>${drills[key].text}</p><small>${drills[key].target}</small></article>`).join('');
  }

  function coachPanel(roundIndex) {
    const diagnosis = state.coach[roundIndex] || AICoach.diagnose(state.results[roundIndex], exercise(roundIndex), roundIndex);
    const retry = state.retryResults[roundIndex]; const comparison = retry ? AICoach.compare(state.results[roundIndex], retry) : null;
    return `<section class="ai-coach-panel"><div class="coach-intro"><p class="eyebrow">AI COACH · 引导重说</p><h2>先定位问题，不直接给答案。</h2><p>${escapeHtml(diagnosis.boundary)}</p></div><div class="coach-issues">${diagnosis.issues.map((item, index) => `<article class="${index === 0 ? 'primary-issue' : ''}"><span>${escapeHtml(item.dimension)} · 0${index + 1}</span><h3>${escapeHtml(item.title)}</h3><p><b>证据</b>${escapeHtml(item.evidence)}</p><p><b>影响</b>${escapeHtml(item.impact)}</p>${index === 0 ? `<blockquote>${escapeHtml(item.question)}</blockquote>` : ''}</article>`).join('')}</div><aside class="coach-retry">${comparison ? `<span>重说后的变化</span><strong>${comparison.scoreDelta >= 0 ? '+' : ''}${comparison.scoreDelta}<small>分</small></strong><p>知识点 ${comparison.conceptDelta >= 0 ? '+' : ''}${comparison.conceptDelta} · 填充词减少 ${comparison.fillerDelta} 次</p><p>重复减少 ${comparison.repetitionDelta} · 冗余减少 ${comparison.redundancyDelta} · 信息密度 ${comparison.densityDelta >= 0 ? '+' : ''}${comparison.densityDelta}</p><button id="show-reference" class="secondary-button" type="button">${state.referenceVisible[roundIndex] ? '已显示参考结构' : '查看参考表达'}</button>${state.referenceVisible[roundIndex] ? `<blockquote class="reference-answer">${escapeHtml(AICoach.reference(exercise(roundIndex)))}</blockquote>` : ''}` : `<span>下一步</span><strong>再说一次</strong><p>只回应上面的引导问题。重说成绩单独显示，不改变你的独立测评等级。</p><button id="guided-retry" class="primary-button" type="button">根据问题重新表达 ${icons.arrow}</button>`}</aside></section>`;
  }

  function bindCoach(roundIndex) {
    document.getElementById('guided-retry')?.addEventListener('click', () => { state.retryMode = roundIndex; state.retryTranscripts[roundIndex] = ''; go(roundIndex === 0 ? 2 : 5); });
    document.getElementById('show-reference')?.addEventListener('click', () => { state.referenceVisible[roundIndex] = true; render(); });
  }

  function analysisScreen() {
    const result = state.results[0]; const item = exercise(0); const advice = oralAdvice(result);
    const invalid = result.scoring.invalid;
    const gateReasons = invalid ? result.scoring.gate.reasons.map((reason) => `<li>${escapeHtml(reason)}</li>`).join('') : '';
    const drillAside = invalid
      ? `<aside class="invalid-drill"><span>有效性审查未通过</span><b>本次不进入权重评分</b><p>第一轮至少 15 秒、第二轮至少 10 秒；同时要有明确观点并覆盖至少一个知识点。</p></aside>`
      : `<aside><span>测评建议</span><b>下一组侧重「${state.recommendation.label}」</b><p>当前薄弱项：${Scoring.COMPONENTS.first[state.recommendation.weakest]} ${state.recommendation.score} 分</p><button id="apply-recommendation" class="secondary-button" type="button">采用建议权重</button></aside>`;
    stage.innerHTML = `
      <div class="stage-heading compact"><div><p class="eyebrow">环节一 · 基础测评结果</p><h1>${invalid ? '本次作答无效，评分为 0。' : '第一轮，你说顺了多少，也说准了多少。'}</h1><p>${invalid ? '权重只决定有效作答后的分数分配，不能替代内容与时间门槛。' : '先看分项，再根据薄弱项决定下一组训练权重。'}</p></div><div class="round-badge score-badge ${invalid ? 'invalid-score' : ''}"><span>${invalid ? '无效作答' : (result.scoring.provisional ? '暂定评分' : '综合评分')}</span><strong>${result.scoring.total}</strong></div></div>
      <div class="analysis-tabs" role="tablist" aria-label="切换分析内容"><button class="active" type="button" role="tab" aria-selected="true" data-analysis-tab="coach">AI 教练</button><button type="button" role="tab" aria-selected="false" data-analysis-tab="overview">评分总览</button><button type="button" role="tab" aria-selected="false" data-analysis-tab="detail">表达与内容</button><button type="button" role="tab" aria-selected="false" data-analysis-tab="drills">训练建议</button></div>
      <div class="analysis-panels">
        <section class="analysis-panel active" data-analysis-panel="coach">${coachPanel(0)}</section>
        <section class="analysis-panel" data-analysis-panel="overview"><section class="score-panel"><header><div><span>当前模型</span><b>${invalid ? '有效性审查' : (state.weightPreset.first === 'custom' ? '自定义权重' : (Scoring.FIRST_PRESETS[state.weightPreset.first]?.label || '基础测评'))}</b></div><p>${invalid ? '以下任一硬性条件不通过，本轮总分和全部分项直接记为 0。' : (result.scoring.provisional ? '本次没有完整停顿数据，未记录项目不参与加权；使用麦克风完成转述后可得到完整评分。' : '评分已包含口头语、停顿、衔接、语速、内容覆盖和语义转换。')}</p></header>${invalid ? `<div class="validity-failure"><b>未通过原因</b><ul>${gateReasons}</ul></div>` : ''}${scoreBreakdown(result, 'first')}</section></section>
        <section class="analysis-panel" data-analysis-panel="detail"><div class="analysis-layout"><article class="analysis-card oral-card"><header><span>维度 01</span><h2>习惯语与口语表达</h2><strong>${result.oral.fluencyScore}<small>/100</small></strong></header>${metricGrid(result)}<div class="habit-list">${renderHabits(result.oral)}</div><div class="coach-advice"><span>表达建议</span>${advice.map((text) => `<p>${escapeHtml(text)}</p>`).join('')}<blockquote>${escapeHtml(result.oral.cleanup)}</blockquote></div></article><article class="analysis-card content-card"><header><span>维度 02</span><h2>内容理解与准确度</h2><strong>${result.content.score}<small>/100</small></strong></header><p class="original-center"><b>原文中心</b>${escapeHtml(item.central)}</p><div class="semantic-method"><span>${result.content.method === 'model-hybrid' ? 'AI 语义 + 关键词' : '本地混合判定 · 暂定'}</span><b>关系 ${result.content.relationScore} / 100</b></div><div class="concept-grid">${result.content.details.map((detail) => `<div class="${detail.hit ? 'hit' : 'miss'}">${detail.hit ? icons.check : '<i></i>'}<span><b>${escapeHtml(detail.label)}</b><small>${detail.hit ? `${{ exact: '原词对应', fuzzy: '近似表达', model: 'AI 语义对应' }[detail.matchType] || '已对应'}：${escapeHtml(detail.evidence || detail.hitTerms.join('、'))}` : (detail.matchType === 'conflict' ? `语义冲突：${escapeHtml(detail.evidence)}` : '你的转述中未明确体现')}</small></span></div>`).join('')}</div><div class="coach-advice"><span>理解建议</span><p>${result.content.missing.length ? `下一轮优先补充“${escapeHtml(result.content.missing.map((item) => item.label).join('、'))}”。` : '四项核心信息均已覆盖，可以进一步压缩句子。'}</p></div></article></div></section>
        <section class="analysis-panel" data-analysis-panel="drills"><section class="drill-section"><div><p class="eyebrow">PERSONAL PRACTICE</p><h2>${invalid ? '先完成一次有效作答' : '把评分变成下一次练习动作'}</h2></div><div class="drill-grid">${invalid ? '<article><span>重新作答</span><h3>先说观点，再补知识点</h3><p>开头先用一句话说明“这段内容主要讲什么”，随后至少补充一个原文知识点。</p><small>目标：第一轮不少于 15 秒，不靠关键词堆叠</small></article><article><span>时间规则</span><h3>过快作答不参与评分</h3><p>几秒完成或语速超过合理口语范围，会被识别为无效作答。</p><small>目标：用自然语速完成完整观点</small></article>' : targetedDrills(result)}</div>${drillAside}</section></section>
      </div>
      <div class="analysis-footer"><button id="redo" class="secondary-button" type="button">重新进行第一轮</button><button id="next-round" class="primary-button" type="button" ${invalid ? 'disabled' : ''}>${invalid ? '通过有效作答后才能继续' : `进入第二环节：30 秒速记 ${icons.arrow}`}</button></div>`;
    document.getElementById('footer-hint').textContent = result.content.method === 'model-hybrid' ? '当前使用 AI 语义、知识点证据与信息关系的混合判定' : '当前使用知识点与信息关系的本地混合暂定判定；接通模型后可识别更多隐含表达';
    // Give practice its own view so wrapped habit chips never share constrained
    // height with advice. Keep the original transcript, not a supplied answer.
    const practice = document.createElement('article');
    practice.className = 'analysis-card advice-card';
    practice.innerHTML = `<header><h2>下一次怎么练</h2></header><ol>${advice.map(text => `<li>${escapeHtml(text)}</li>`).join('')}</ol><details><summary>对照本次原话</summary><p>${escapeHtml(result.transcript)}</p></details>`;
    stage.querySelector('.oral-card .coach-advice').remove();
    stage.querySelector('.analysis-layout').append(practice);
    if (result.preview && !invalid) stage.querySelector('.score-panel header p').textContent = '本地规则暂定评分。录音间隔为声学估计；没有证据的项目不参与加权，未接通云端 AI 语义评估。';
    document.getElementById('apply-recommendation')?.addEventListener('click', (event) => {
      state.weights.first = Scoring.cloneWeights(state.recommendation.weights); state.weightPreset.first = state.recommendation.presetKey;
      event.currentTarget.textContent = '已采用，下次训练生效'; event.currentTarget.disabled = true;
    });
    document.querySelectorAll('[data-analysis-tab]').forEach((button) => button.addEventListener('click', () => {
      document.querySelectorAll('[data-analysis-tab]').forEach((item) => { const active = item === button; item.classList.toggle('active', active); item.setAttribute('aria-selected', String(active)); });
      document.querySelectorAll('[data-analysis-panel]').forEach((panel) => panel.classList.toggle('active', panel.dataset.analysisPanel === button.dataset.analysisTab));
    }));
    document.getElementById('redo').addEventListener('click', () => {
      state.backendAttemptKey = ''; state.backendReady = null; state.submittedRequest = null;
      go(1);
    });
    document.getElementById('next-round').addEventListener('click', () => go(4));
    bindCoach(0);
  }

  function metricGrid(result) {
    const duration = result.elapsed ? formatTime(result.elapsed) : '未记录';
    const hasPauses = result.pauseEvidence?.available || result.pauses?.length;
    return `<div class="data-grid"><div><span>表达时长</span><strong>${duration}</strong></div><div><span>平均停顿（估计）</span><strong>${hasPauses ? `${result.averagePause.toFixed(1)}s` : '未记录'}</strong></div><div><span>最长停顿（估计）</span><strong>${hasPauses ? `${result.longestPause.toFixed(1)}s` : '未记录'}</strong></div><div><span>语速</span><strong>${result.pace ? `${result.pace} 字/分` : '未记录'}</strong></div><div><span>填充/语气</span><strong>${result.oral.counts.fillers} 次</strong></div><div><span>衔接词</span><strong>${result.oral.counts.connectors} 次</strong></div></div><p class="pause-method">${result.pauseEvidence?.available ? `录音内 ≥0.5 秒的低音量间隔：${result.pauses.length} 次。排除首尾等待；噪声可能影响估计。` : '本次没有可用的录音间隔证据，不能用文字补算。'}</p>`;
  }
  function renderHabits(oral) {
    const groups = [['填充/语气', oral.groups.fillers], ['衔接词', oral.groups.connectors], ['犹豫表达', oral.groups.hedges], ['连续重复', oral.cleanliness.repetitions.map((item) => ({ term: item.text, count: item.count }))], ['自我修正', oral.cleanliness.selfCorrections.map((item) => ({ term: item.marker, count: item.count }))]];
    const rows = groups.flatMap(([label, items]) => items.slice(0, 3).map((item) => `<span><i>${label}</i><b>${escapeHtml(item.term)}</b><em>${item.count} 次</em></span>`));
    return rows.length ? rows.join('') : '<p>未发现明显的高频口头习惯。</p>';
  }

  function ensureSessionRecorded() {
    if (state.sessionRecorded || !state.results[0] || !state.results[1]) return;
    // Demonstrations and incomplete speech evidence are feedback, not growth evidence.
    if (state.results.some((result) => result.assessment?.mode !== 'independent' || (!Backend.preview && result.scoring.provisional && !result.scoring.invalid))) {
      state.sessionRecorded = true; Session.clear(); return;
    }
    const valid = !state.results[0].scoring.invalid && !state.results[1].scoring.invalid;
    const baseline = state.results.map((result) => result.baselineScoring || result.scoring);
    const score = valid ? Progress.abilityIndex(baseline[0].total, baseline[1].total) : 0;
    state.progress = Progress.recordSession(state.progress, {
      valid, score, baselineVersion: 'default-weights-v1', localPreview: true, scene: activeSet().label, planId: Progress.activePlan(state.progress)?.id || null,
      firstScore: state.results[0].scoring.total, secondScore: state.results[1].scoring.total,
      dimensions: valid ? Progress.dimensionScores(state.results[0], state.results[1]) : null,
      transcripts: state.transcripts.slice(), timing: state.results.map((item) => ({ elapsed: item.elapsed, pace: item.pace, pauses: item.pauses })),
      diagnoses: state.coach, retryScores: state.retryResults.map((item) => item?.scoring?.total ?? null), corrected: state.retryResults.some(Boolean)
    });
    state.progress = Progress.save(state.progress); state.sessionRecorded = true; Session.clear();
  }

  function finalScreen() {
    const first = state.results[0]; const second = state.results[1]; const item = exercise(1);
    ensureSessionRecorded(); const growth = Progress.profile(state.progress);
    stage.innerHTML = `
      <div class="stage-heading compact"><div><p class="eyebrow">训练完成 · 综合结果</p><h1>两轮结束，看看你抓取信息的变化。</h1><p>第一轮重在表达习惯，第二轮重在中心思想和关键词抓取；两轮权重不同，不做简单高低比较。</p></div><div class="round-badge complete"><span>DONE</span>${icons.check}</div></div>
      <div class="final-layout">
        <section class="comparison-card"><header><h2>两轮分项目标</h2><span>${escapeHtml(activeSet().label)}</span></header><div class="compare-table"><div class="table-head"><span>分析指标</span><b>基础测评</b><b>30 秒轮</b></div><div><span>综合评分</span><b>${first.scoring.total}</b><b>${second.scoring.total}</b></div><div><span>中心思想</span><b>${first.scoring.components.centralAccuracy}</b><b>${second.scoring.components.centralAccuracy}</b></div><div><span>关键内容</span><b>${first.scoring.components.keyCoverage}</b><b>${second.scoring.components.keyCoverage}</b></div><div><span>口头语控制</span><b>${first.scoring.components.oralControl}</b><b>${second.scoring.components.oralControl}</b></div><div><span>衔接与逻辑</span><b>${first.scoring.components.connectorLogic}</b><b>${second.scoring.components.connectorLogic}</b></div></div><div class="trend-note positive">第二轮中心思想权重<strong>35%</strong></div></section>
        <section class="memory-result"><span>短时关键信息</span><h2>${second.content.matched.length} / ${item.concepts.length} 项已提取</h2><div>${second.content.details.map((detail) => `<p class="${detail.hit ? 'hit' : 'miss'}">${detail.hit ? icons.check : '<i></i>'}<span><b>${escapeHtml(detail.label)}</b><small>${detail.hit ? '已准确表达' : '本轮遗漏'}</small></span></p>`).join('')}</div><blockquote>${escapeHtml(item.central)}</blockquote><div class="framework-box"><b>下一次用「一核三问」速记</b><ol><li><span>一核</span>这段话主要说明什么？</li><li><span>问题</span>它在解决什么问题？</li><li><span>关系</span>原因、转折或条件是什么？</li><li><span>落点</span>最后得到什么结论或行动？</li></ol></div></section>
        <section class="next-action"><p class="eyebrow">L${growth.earned.id} · ${growth.earned.name}</p><h2>${second.scoring.invalid ? '第二轮作答无效。' : `当前能力指数 ${growth.current}`}</h2><p>${second.scoring.invalid ? `本轮触发：${second.scoring.gate.reasons.join('、')}。本次记 0 并中断连续记录，但不降低已获得等级。` : second.oral.counts.fillers ? `在下一轮中，把最常见的“${second.oral.groups.fillers[0]?.term || '填充词'}”改成短暂停顿。` : second.content.missing.length ? `30 秒阅读时，先记住“${second.content.missing[0].label}”这一类信息。` : '把总结压缩到“一个中心思想 + 三个信息点”，控制在 45 秒内。'}</p><button id="second-coach" class="coach-link" type="button">AI 只指出问题，引导我重说一次</button><div class="final-actions"><button id="restart" class="secondary-button" type="button">返回选题</button><button id="view-growth" class="primary-button" type="button">查看成长档案 ${icons.arrow}</button></div><small>独立作答计入等级；AI 引导后的重说只展示学习变化，不改写本次等级。</small></section>
      </div>`;
    document.getElementById('footer-hint').textContent = '可以返回内容首页，也可以随机切换到任意知识板块';
    const growthNote = stage.querySelector('.next-action small');
    if (growthNote) growthNote.textContent = state.results.some((result) => result.assessment?.mode !== 'independent' || (result.scoring.provisional && !result.scoring.invalid))
      ? '本次为示例或暂定反馈，已保存作答，但不改变成长等级或连续记录。正式考试与云端等级尚未接通。'
      : '成长趋势使用固定基准权重；当前档案为本地练习记录，尚非独立考试认证。';
    document.getElementById('restart').addEventListener('click', () => { resetPractice(); go(0); });
    document.getElementById('view-growth').addEventListener('click', () => openView('growth'));
    document.getElementById('second-coach').addEventListener('click', () => { state.retryMode = 1; go(5); });
  }

  function viewHeading(kicker, title, copy) {
    return `<div class="view-heading"><button class="view-back" data-back-training type="button">${icons.back} 返回训练</button><div><p class="eyebrow">${kicker}</p><h1>${title}</h1><p>${copy}</p></div></div>`;
  }

  function bindViewBack() {
    document.querySelectorAll('[data-back-training]').forEach((button) => button.addEventListener('click', () => openView('training')));
  }

  function growthScreen() {
    const profile = Progress.profile(state.progress); const plan = Progress.activePlan(state.progress);
    const bars = Object.entries(Progress.DIMENSIONS).map(([key, label]) => {
      const value = profile.dimensions[key];
      return `<div class="ability-row"><span>${label}</span><i><b style="width:${Number.isFinite(value) ? value : 0}%"></b></i><strong>${Number.isFinite(value) ? value : '--'}</strong></div>`;
    }).join('');
    const trend = profile.recent.length ? profile.recent.map((value, index) => `<i style="height:${Math.max(8, value)}%"><span>${value}</span><small>${index + 1}</small></i>`).join('') : '<p>完成一次两轮训练后，这里会出现真实趋势。</p>';
    stage.innerHTML = `${viewHeading('GROWTH PROFILE', '成长看得见，等级不被一次失误带走。', '等级只使用独立作答；AI 引导后的提升单独记录。无效作答记 0 并中断连续记录，但不降低已获得等级。')}<div class="growth-layout"><section class="level-card"><span>已获得等级</span><div><b>L${profile.earned.id}</b><h2>${profile.earned.name}</h2></div><strong>${profile.current}<small>/100 当前能力指数</small></strong><p>${profile.next ? `距离 L${profile.next.id} ${profile.next.name} 还差 ${profile.distance} 分` : '已到达最高等级，下一步检验跨场景迁移。'}</p><footer><span>历史最高 <b>${profile.historicalHigh}</b></span><span>连续有效 <b>${profile.streak}</b></span><span>有效记录 <b>${profile.validCount}</b></span></footer></section><section class="ability-card"><header><div><span>六项能力</span><h2>最近 5 次独立作答</h2></div><b>${profile.change >= 0 ? '+' : ''}${profile.change}</b></header>${bars}</section><section class="trend-card"><header><span>最近变化</span><b>${profile.recent.length}/5 次证据</b></header><div class="mini-trend">${trend}</div><p>${profile.validCount < 3 ? `再完成 ${3 - profile.validCount} 次有效训练，系统会形成更稳定的基线。` : (profile.change >= 0 ? '近期趋势上升，建议在薄弱项不变的情况下申请一次测试。' : '近期有波动，先完成一组针对性训练再测试。')}</p><div class="growth-actions"><button id="growth-plan" class="secondary-button" type="button">${plan ? '查看当前计划' : '生成专项计划'}</button><button id="growth-train" class="primary-button" type="button">继续训练 ${icons.arrow}</button></div></section></div>`;
    document.getElementById('footer-hint').textContent = '本机练习档案，非云端等级认证；固定诊断权重不随训练侧重点改变';
    bindViewBack(); document.getElementById('growth-plan').addEventListener('click', () => openView('plans')); document.getElementById('growth-train').addEventListener('click', () => openView('training'));
  }

  function dimensionOptions(selected) {
    return Object.entries(Progress.DIMENSIONS).map(([key, label]) => `<option value="${key}" ${key === selected ? 'selected' : ''}>${label}</option>`).join('');
  }

  function plansScreen() {
    const profile = Progress.profile(state.progress); const active = Progress.activePlan(state.progress);
    const draft = state.planDraft || active || Progress.recommendPlan(state.progress); state.planDraft = Object.assign({}, draft, { ratios: Object.assign({}, draft.ratios) });
    const ready = Progress.readiness(state.progress);
    const saved = state.progress.plans.length ? state.progress.plans.map((plan) => `<button type="button" data-activate-plan="${plan.id}" class="saved-plan ${plan.id === state.progress.activePlanId ? 'active' : ''}"><span>${plan.id === state.progress.activePlanId ? '使用中' : '已保存'}</span><b>${escapeHtml(plan.name)}</b><small>${Progress.DIMENSIONS[plan.primary]} ${plan.ratios.primary}% · ${Progress.PLAN_MODES[plan.mode]}</small></button>`).join('') : '<p class="plan-empty">还没有保存计划。系统已按现有训练记录推荐一份可修改草案。</p>';
    stage.innerHTML = `${viewHeading('PERSONAL PLAN', '按训练结果推荐，由你决定。', '可修改痛点、训练比例、内容来源和目标；同一时间只执行一个计划，其他计划保留。')}<div class="plans-layout"><section class="plan-editor"><header><div><span>当前草案</span><h2>创建或修改专项计划</h2></div><b>总计 <i id="plan-total">${draft.ratios.primary + draft.ratios.secondary + draft.ratios.maintenance}</i>%</b></header><label><span>计划名称</span><input id="plan-name" value="${escapeHtml(draft.name)}" maxlength="30"></label><div class="plan-focus-grid"><label><span>主攻 60%</span><select id="plan-primary">${dimensionOptions(draft.primary)}</select></label><label><span>次要 25%</span><select id="plan-secondary">${dimensionOptions(draft.secondary)}</select></label><label><span>保持 15%</span><select id="plan-maintenance">${dimensionOptions(draft.maintenance)}</select></label></div><div class="ratio-grid"><label><span>主攻</span><input id="ratio-primary" type="number" min="0" max="100" value="${draft.ratios.primary}"><b>%</b></label><label><span>次要</span><input id="ratio-secondary" type="number" min="0" max="100" value="${draft.ratios.secondary}"><b>%</b></label><label><span>保持</span><input id="ratio-maintenance" type="number" min="0" max="100" value="${draft.ratios.maintenance}"><b>%</b></label></div><div class="plan-choice-row"><label><span>计划目标</span><select id="plan-mode"><option value="consolidate" ${draft.mode === 'consolidate' ? 'selected' : ''}>巩固 · 基线 +5</option><option value="improve" ${draft.mode === 'improve' ? 'selected' : ''}>提升 · 基线 +10</option><option value="levelup" ${draft.mode === 'levelup' ? 'selected' : ''}>冲级 · 下一等级线</option></select></label><label><span>内容来源</span><select id="plan-source"><option value="mixed" ${draft.source === 'mixed' ? 'selected' : ''}>导入知识 + 预训练</option><option value="knowledge" ${draft.source === 'knowledge' ? 'selected' : ''}>优先我的知识</option><option value="prebuilt" ${draft.source === 'prebuilt' ? 'selected' : ''}>预训练题库</option></select></label></div><p id="plan-error" class="input-error"></p><button id="save-plan" class="primary-button" type="button">保存并开始执行 ${icons.arrow}</button></section><section class="plan-side"><article class="readiness-card"><span>考试准备度 · 建议值</span><strong>${ready.score}<small>/100</small></strong><p>${ready.label}</p><button id="start-exam" class="secondary-button" type="button">申请专项考试</button><small>不必完成固定次数；你可以随时切换训练或申请考试。</small></article><article class="saved-plans"><header><h2>我的计划</h2><span>${state.progress.plans.length} 份</span></header><div>${saved}</div></article></section></div>`;
    document.querySelector('.saved-plans header').insertAdjacentHTML('beforeend', '<button id="new-plan" type="button">另建计划</button>');
    document.getElementById('footer-hint').textContent = '默认比例 60 / 25 / 15；保存前可自由调整，总和必须为 100%';
    bindViewBack();
    document.querySelectorAll('.ratio-grid input').forEach((input) => input.addEventListener('input', () => { document.getElementById('plan-total').textContent = Number(document.getElementById('ratio-primary').value || 0) + Number(document.getElementById('ratio-secondary').value || 0) + Number(document.getElementById('ratio-maintenance').value || 0); }));
    document.getElementById('save-plan').addEventListener('click', () => {
      const mode = document.getElementById('plan-mode').value; const nextLevel = Progress.nextLevel(profile.current);
      const candidate = { id: state.planDraft?.id || null, name: document.getElementById('plan-name').value.trim() || '我的专项计划', primary: document.getElementById('plan-primary').value, secondary: document.getElementById('plan-secondary').value, maintenance: document.getElementById('plan-maintenance').value, ratios: { primary: Number(document.getElementById('ratio-primary').value), secondary: Number(document.getElementById('ratio-secondary').value), maintenance: Number(document.getElementById('ratio-maintenance').value) }, mode, source: document.getElementById('plan-source').value, baseline: profile.current, target: mode === 'consolidate' ? Math.min(100, profile.current + 5) : mode === 'levelup' && nextLevel ? nextLevel.min : Math.min(100, profile.current + 10) };
      try { state.progress = Progress.save(Progress.upsertPlan(state.progress, candidate)); state.planDraft = null; render(); } catch (error) { document.getElementById('plan-error').textContent = error.message; }
    });
    document.querySelectorAll('[data-activate-plan]').forEach((button) => button.addEventListener('click', () => { state.progress.activePlanId = button.dataset.activatePlan; state.progress = Progress.save(state.progress); state.planDraft = null; render(); }));
    document.getElementById('new-plan').addEventListener('click', () => { state.planDraft = Object.assign({}, Progress.recommendPlan(state.progress), { id: null, name: '新的专项计划' }); render(); });
    document.getElementById('start-exam').addEventListener('click', startExam);
  }

  function startExam() {
    const pool = SETS.slice().sort(() => Math.random() - .5); const firstSet = pool[0] || activeSet(); const secondSet = pool[1] || activeSet();
    state.exam = { taskIndex: 0, phase: 'prep', startedAt: 0, answers: [], results: [], tasks: [
      { label: '长段转述', weight: 35, round: 'first', exercise: firstSet.rounds[0], source: firstSet.label, prep: '30 秒至 5 分钟阅读后转述' },
      { label: '30 秒速记', weight: 35, round: 'second', exercise: secondSet.rounds[1], source: secondSet.label, prep: '30 秒抓取中心与信息点' },
      { label: '迁移表达', weight: 30, round: 'first', exercise: firstSet.rounds[1], source: '陌生听众解释', prep: '把知识解释给不了解它的人' }
    ] };
    openView('exam');
  }

  function examScreen() {
    const exam = state.exam;
    if (!exam) { openView('plans'); return; }
    if (exam.phase === 'result') { examResultScreen(); return; }
    const task = exam.tasks[exam.taskIndex]; const progress = exam.tasks.map((item, index) => `<i class="${index === exam.taskIndex ? 'active' : index < exam.taskIndex ? 'done' : ''}"><b>${index + 1}</b><span>${item.label} · ${item.weight}%</span></i>`).join('');
    const isPrep = exam.phase === 'prep';
    stage.innerHTML = `${viewHeading('FOCUS EXAM', `专项考试 · ${task.label}`, '考试使用全新内容，作答期间不提供 AI 提示、框架或参考答案；任一题无效则本次考试不通过。')}<div class="exam-progress">${progress}</div><div class="exam-layout"><article class="exam-material ${isPrep ? '' : 'hidden-material'}"><header><span>${escapeHtml(task.source)}</span><b>${task.prep}</b></header>${isPrep ? `<h2>${escapeHtml(task.exercise.title)}</h2><p>${escapeHtml(task.exercise.text)}</p>` : `<div class="memory-cover"><span>原文已隐藏</span><h2>请独立完成表达</h2><p>至少形成一个完整观点，并覆盖原文的核心信息。</p></div>`}</article><aside class="exam-action">${isPrep ? `<span>准备阶段</span><h2>读完后隐藏原文</h2><p>正式作答一旦开始，不能返回查看原文。</p><button id="begin-exam-answer" class="primary-button" type="button">开始独立作答 ${icons.arrow}</button>` : `<label for="exam-answer">作答转录稿</label><textarea id="exam-answer" rows="10" placeholder="可使用麦克风之外的文字输入完成原型测试……">${escapeHtml(exam.answers[exam.taskIndex] || '')}</textarea><p id="exam-time">作答计时 00:00</p><p id="exam-error" class="input-error"></p><button id="submit-exam-answer" class="primary-button" type="button">提交本题 ${icons.arrow}</button>`}</aside></div>`;
    document.getElementById('footer-hint').textContent = '本地模拟考试，尚未接通服务端考试认证；不提供 AI 引导重说'; bindViewBack();
    document.getElementById('begin-exam-answer')?.addEventListener('click', () => { exam.phase = 'answer'; exam.startedAt = performance.now(); render(); });
    document.getElementById('exam-answer')?.addEventListener('input', (event) => { exam.answers[exam.taskIndex] = event.target.value; });
    document.getElementById('submit-exam-answer')?.addEventListener('click', submitExamAnswer);
    if (!isPrep) {
      if (state.timeTicker) clearInterval(state.timeTicker);
      const updateExamTime = () => { const node = document.getElementById('exam-time'); if (node) node.textContent = `作答计时 ${formatTime(Math.max(0, Math.floor((performance.now() - exam.startedAt) / 1000)))}`; };
      updateExamTime(); state.timeTicker = setInterval(updateExamTime, 500);
    }
  }

  function submitExamAnswer() {
    const exam = state.exam; const task = exam.tasks[exam.taskIndex]; const text = exam.answers[exam.taskIndex] || '';
    if (!Analyzer.countChineseLike(text)) { document.getElementById('exam-error').textContent = '请先完成本题。'; return; }
    if (state.timeTicker) clearInterval(state.timeTicker); state.timeTicker = null;
    const oral = Analyzer.analyze(text); const content = evaluate(task.exercise, text); const elapsed = Math.max(1, Math.round((performance.now() - exam.startedAt) / 1000));
    const raw = { oral, content, elapsed, averagePause: 0, longestPause: 0, pace: Math.round(oral.charCount / elapsed * 60), pauses: [], transcript: text };
    raw.scoring = Scoring.calculate(task.round, raw, task.exercise, Scoring.DEFAULT_WEIGHTS[task.round]); exam.results[exam.taskIndex] = raw;
    if (raw.scoring.invalid || exam.taskIndex === exam.tasks.length - 1) exam.phase = 'result';
    else { exam.taskIndex += 1; exam.phase = 'prep'; exam.startedAt = 0; }
    render();
  }

  function examResultScreen() {
    const exam = state.exam; const invalid = exam.results.some((result) => result?.scoring?.invalid) || exam.results.length < 3;
    const score = invalid ? 0 : Math.round(exam.results.reduce((sum, result, index) => sum + result.scoring.total * exam.tasks[index].weight / 100, 0));
    const plan = Progress.activePlan(state.progress); const target = plan?.target || 75; const passed = !invalid && score >= target;
    if (!exam.saved) { state.progress.exams.push({ id: `exam-${Date.now()}`, at: new Date().toISOString(), score, passed, invalid, planId: plan?.id || null }); state.progress = Progress.save(state.progress); exam.saved = true; }
    stage.innerHTML = `${viewHeading('EXAM RESULT', passed ? '本地模拟达标，等待正式检验。' : '本次暂未达标，先补一次针对训练。', passed ? '你可以继续提高目标或切换专项计划。' : '考试不降低已获得等级，也不会清空当前计划；补练后会换一组新题。')}<div class="exam-result-layout"><section class="exam-score ${passed ? 'passed' : ''}"><span>${invalid ? '无效考试' : '考试总分'}</span><strong>${score}</strong><p>${invalid ? '任一题未达到时间、观点或知识点门槛，整场考试判为不通过。' : `目标线 ${target} 分 · ${passed ? '已达到' : `还差 ${target - score} 分`}`}</p></section><section class="exam-task-results">${exam.tasks.map((task, index) => { const result = exam.results[index]; return `<article><span>${task.weight}%</span><div><h3>${task.label}</h3><p>${result ? (result.scoring.invalid ? result.scoring.gate.reasons.join('、') : '有效独立作答') : '未完成'}</p></div><strong>${result?.scoring?.total ?? 0}</strong></article>`; }).join('')}</section><aside class="exam-next"><span>下一步</span><h2>${passed ? '开启新的目标' : '保留计划，完成一次补练'}</h2><p>${passed ? 'AI 会继续按六项能力中最弱的一项推荐下一计划。' : '回到训练后仍使用当前计划；再次申请考试时自动更换内容。'}</p><button id="exam-back-plans" class="secondary-button" type="button">返回专项计划</button><button id="exam-go-train" class="primary-button" type="button">${passed ? '继续训练' : '开始补练'} ${icons.arrow}</button></aside></div>`;
    document.getElementById('footer-hint').textContent = '未通过不会降级；无效答题仍为 0 分并结束本场考试'; bindViewBack();
    document.getElementById('exam-back-plans').addEventListener('click', () => { state.exam = null; openView('plans'); });
    document.getElementById('exam-go-train').addEventListener('click', () => { state.exam = null; chooseRandomSet(); resetPractice(); go(1); });
  }

  function render() {
    stage.className = 'stage stage-enter';
    stage.dataset.step = String(state.step); stage.dataset.view = state.view;
    if (state.view === 'growth') growthScreen();
    else if (state.view === 'plans') plansScreen();
    else if (state.view === 'exam') examScreen();
    else if (state.missingKnowledge) missingKnowledgeScreen();
    else if (state.step === 0) selectionScreen();
    else if (state.step === 1) readingScreen(0);
    else if (state.step === 2) retellScreen(0);
    else if (state.step === 3) analysisScreen();
    else if (state.step === 4) readingScreen(1);
    else if (state.step === 5) retellScreen(1);
    else finalScreen();
    window.ExpressionLayout.enhance(stage);
    if (Backend.preview) {
      document.getElementById('brand-subtitle').textContent = '语音增强版 · 记录仅在本机';
      document.getElementById('footer-hint').textContent = '本地规则暂定评分 · 火山语音已接通 · 云端统计未接通';
      const intro = stage.querySelector('.selection-heading > p:last-child');
      if (intro) intro.textContent = '先选内容完成两轮练习。无需用户填写 API Key；转录使用服务端火山语音，评分与引导使用本地规则，记录仅保存在当前浏览器。';
      const kicker = stage.querySelector('.stage-heading .eyebrow');
      if (kicker) kicker.textContent = `${kicker.textContent.replace('AI', '规则')} · 火山转录`;
      const coachTab = stage.querySelector('[data-analysis-tab="coach"]');
      if (coachTab) coachTab.textContent = '规则教练';
      const coachLabel = stage.querySelector('.coach-intro .eyebrow');
      if (coachLabel) coachLabel.textContent = '本地规则 · 引导重说（未接通 AI）';
      const secondCoach = stage.querySelector('#second-coach');
      if (secondCoach) secondCoach.textContent = '根据问题引导，重新说一次';
      const note = stage.querySelector('.next-action small');
      if (note) note.textContent = '本机暂定记录，不是 AI 测评或正式等级；示例与引导重说不计入独立训练次数。';
      const levelLabel = stage.querySelector('.level-card > span');
      if (levelLabel) levelLabel.textContent = '本机练习参考等级 · 暂定';
      const headingCopy = stage.querySelector('.view-heading > div > p:last-child');
      if (state.view === 'growth' && headingCopy) headingCopy.textContent = '仅展示当前浏览器的练习次数和本地规则评分变化，未接通云端统计，也不是经过 AI 核验的能力等级。';
    }
  }

  async function checkSpeechService() {
    if (!state.speechHealthPromise) state.speechHealthPromise = Speech.health().finally(() => { state.speechHealthPromise = null; });
    state.speechService = await state.speechHealthPromise;
    const box = document.getElementById('voice-state');
    if (box && (state.step === 2 || state.step === 5) && !state.recording && !state.transcriptionPending && !state.microphonePending) {
      setVoiceStatus(state.speechService.available ? '火山高精度转录已就绪' : '浏览器转录模式', state.speechService.available ? `${state.speechService.model || '火山语音'} · 录音结束后生成准确稿` : `${state.speechService.reason || '高精度服务未启动'}；文字输入始终可用`, state.speechService.available ? 'ready' : 'warning');
    }
    updateRealtimeLabel();
  }

  document.getElementById('theme-switch').addEventListener('click', () => { state.theme = state.theme === 'programa' ? 'v0' : 'programa'; applyTheme(); render(); });
  document.getElementById('growth-nav').addEventListener('click', () => openView('growth'));
  document.getElementById('plans-nav').addEventListener('click', () => openView('plans'));
  window.addEventListener('beforeunload', persistDraft);
  // Android's native lifecycle dispatches this only when the activity leaves the screen,
  // not when the system microphone permission dialog temporarily takes focus.
  window.addEventListener('expression:app-background', () => {
    if (state.recording || state.speechIntentActive) void toggleRecording(state.step === 5 ? 1 : 0);
    if (state.calibration?.recorder?.state === 'recording') state.calibration.recorder.stop();
    state.calibration?.stream?.getTracks().forEach((track) => track.stop());
    persistDraft();
  });
  loadSessionKnowledge(); applyTheme(); updateChrome(); render();
  async function initializeTraining() {
    await Backend.modelAccess;
    if (Backend.sponsored()) {
      document.getElementById('settings-link').textContent = '设置 · 内测';
      document.getElementById('settings-link').title = '内测模型费用由维护者承担';
    }
    if (autoStartRequested && hasModelConnection() && !state.missingKnowledge) {
      const cleanUrl = new URL(window.location.href); cleanUrl.searchParams.delete('autostart'); window.history.replaceState(null, '', cleanUrl);
      resetPractice(); go(1);
    } else if (autoStartRequested && !hasModelConnection()) {
      openModelSettings(true);
    }
  }
  void initializeTraining();
  checkSpeechService();
})();
