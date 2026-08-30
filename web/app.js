(function () {
  'use strict';

  const A = window.ExpressionAnalyzer;
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => Array.from(document.querySelectorAll(selector));
  const escapeHtml = (value) => String(value || '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));

  const SAMPLES = [
    {
      id: 'report', category: '工作表达', title: '一次清晰的项目复盘', difficulty: '入门', minutes: 4,
      keywords: ['结论', '用户反馈', '转化率', '流程', '验证', '下一步'],
      text: `先说结论：这次项目没有达到最初设定的转化目标，但它帮助我们更早发现了真正的问题，因此仍然是一轮有价值的验证。复盘时，我想从结果、原因和下一步三个方面展开。\n\n第一点是结果。上线两周后，页面访问量基本符合预期，真正完成注册的用户却明显偏少。用户不是没有兴趣，而是在填写资料和等待验证码的环节大量退出。这说明问题不在获客，而在首次使用流程。\n\n第二点是原因。我们访谈了十二位中途退出的用户，其中大部分人都提到：他们在进入页面后，不能立刻理解注册能够获得什么，也不知道填写资料需要多长时间。换句话说，我们强调了功能，却没有先说明价值；要求用户付出时间，却没有给出明确预期。\n\n第三点是改进方案。下一版会把核心价值放在首屏，用一句话说明用户完成注册后能够得到的结果。同时，我们会把五项必填内容缩减为两项，其余信息等用户体验核心功能后再补充。最后，我们会保留新旧两个版本，用一周时间比较注册完成率，而不是凭感觉判断设计好坏。\n\n总的来说，这次复盘最重要的收获不是“页面还需要优化”，而是我们找到了一个可以被验证的具体阻碍。下一步的目标也很明确：先降低首次使用成本，再观察用户是否愿意继续留下来。`
    },
    {
      id: 'interview', category: '面试表达', title: '如何介绍一个复杂项目', difficulty: '进阶', minutes: 5,
      keywords: ['背景', '目标', '职责', '决策', '结果', '复盘'],
      text: `介绍复杂项目时，最容易出现的问题是信息很多，却没有一条清楚的主线。听众听见了大量细节，却不知道你解决了什么问题，也不知道你在其中发挥了什么作用。一个更有效的方法，是按照背景、目标、行动、结果和反思来组织表达。\n\n首先，用两三句话交代背景。背景不是公司的完整历史，而是与任务直接相关的限制条件。例如，团队希望在一个月内验证新用户是否愿意为某项服务付费，但当时没有成熟产品，也没有稳定流量。这两句话已经足够让听众理解难度。\n\n其次，要说清你的目标和职责。不要只说“我们做了一个项目”，而要说明你具体负责哪一部分、需要推动哪些人、用什么指标判断成功。职责越清楚，后面的行动才越有意义。\n\n接着，选择一到两个关键决策展开。复杂项目里通常有许多动作，但不是每个动作都值得讲。真正能体现能力的，是你面对不确定性时如何取舍。例如，时间不足时为什么先做人工服务，而不是直接开发完整系统；数据不够时如何设计低成本测试；意见不一致时如何让团队回到共同目标。\n\n然后，用可验证的结果收束。结果可以是增长，也可以是发现原假设不成立。重要的是说明证据来自哪里，以及这个结果如何影响下一步。最后补充一段反思：如果重新来一次，你会保留什么、改变什么。这样的表达不会把项目包装成完美成功，却能让听众看见你的判断力、执行力和学习能力。`
    },
    {
      id: 'explain', category: '公众表达', title: '为什么真正的沟通始于理解', difficulty: '进阶', minutes: 5,
      keywords: ['沟通', '理解', '立场', '提问', '确认', '行动'],
      text: `很多人把沟通理解为“把自己的话说出去”，仿佛声音足够响、理由足够多，对方就一定能够接受。但真正有效的沟通，通常不是从表达开始，而是从理解开始。这里的理解，不是同意对方，而是先弄清楚对方看见了什么、担心什么、希望保护什么。\n\n当两个人意见不一致时，我们很容易立即进入证明模式。一个人不断补充理由，另一个人不断寻找反例，双方说得越来越多，距离却越来越远。原因在于，他们回应的不是对方真正的问题，而是自己想象中的问题。\n\n要打破这种循环，可以先做三件小事。第一，复述对方的核心观点，并请他确认。复述不是机械重复，而是用自己的话说明你听见的重点。第二，询问判断背后的依据。与其问“你为什么不同意我”，不如问“你最担心这个方案带来什么后果”。第三，区分立场和利益。立场是“我不同意延期”，利益可能是“我担心错过市场窗口”。一旦看见利益，双方就可能找到新的方案。\n\n理解之后，表达也会变得更准确。你不再需要一次说服所有人，而是能够针对具体担忧给出证据、边界和选择。最后还要确认行动：我们达成了什么共识，仍有哪些分歧，谁在什么时间完成下一步。\n\n所以，沟通的目标不应该只是“我已经说过了”，而应该是“我们是否形成了同一个问题版本”。从理解出发，不会让沟通变慢；相反，它减少了反复解释和情绪消耗，让真正需要讨论的部分更快浮现出来。`
    },
    {
      id: 'story', category: '叙事表达', title: '一次迟到的决定', difficulty: '挑战', minutes: 4,
      keywords: ['犹豫', '选择', '机会', '代价', '判断', '行动'],
      text: `三年前，我曾经收到一个看起来并不稳妥的机会：加入一个只有五个人的小团队，去做一款还没有被市场证明的产品。那时我已经有一份稳定工作，收入不错，流程熟悉，也知道下一年大概会发生什么。新机会恰恰相反，它没有清晰的职位边界，甚至不能保证半年后项目还存在。\n\n我用了很长时间比较两边的优缺点。我列了表格，问了朋友，也反复设想失败后的情形。表面上，我是在认真做决定；后来回头看，我其实是在等待一个没有风险的答案。由于迟迟没有回复，对方最终选择了另一位候选人。那一刻我并没有立刻后悔，反而松了一口气，因为决定终于不再需要由我来做。\n\n几个月后，我看到那支团队发布了第一版产品。产品并不完美，却真实地被用户使用。让我难受的不是错过了所谓的成功，而是我突然意识到：自己把“不确定”直接等同于“不值得”。我只计算了行动可能付出的代价，却没有计算长期不行动的代价。\n\n这件事改变了我后来的判断方式。面对重要选择时，我仍然会分析风险，但会给分析设定期限。我也会问自己三个问题：最坏的结果是否可以承受？这次选择能否带来新的能力和关系？如果一年后回看，我更可能后悔尝试，还是后悔没有尝试？\n\n成熟不是每次都选对，而是在信息不完整时仍然能够承担一个经过思考的决定。犹豫可以保护我们不被冲动带走，但当犹豫没有期限，它也会悄悄替我们做出选择。`
    }
  ];

  const state = {
    sample: SAMPLES[0], recognition: null, recognitionTarget: null, recording: false,
    uncertainty: [], timer: null, latestAnalysis: null, micGranted: false,
    speechSupported: false, mediaSupported: false, activeRecordButton: null, recognitionFailed: false
  };

  function toast(message) {
    const node = $('#toast');
    node.textContent = message;
    node.classList.add('show');
    clearTimeout(node._timer);
    node._timer = setTimeout(() => node.classList.remove('show'), 2200);
  }

  function switchView(view) {
    $$('.view').forEach((node) => node.classList.toggle('active', node.id === `view-${view}`));
    $$('.nav-item').forEach((button) => {
      const active = button.dataset.view === view;
      button.classList.toggle('active', active);
      if (active) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
    });
    if (view === 'history') renderHistory();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function updateNotice(mode, title, detail) {
    const notice = $('#speech-notice');
    notice.className = `notice ${mode}`;
    notice.querySelector('strong').textContent = title;
    notice.querySelector('small').textContent = detail;
  }

  function setPermissionStep(id, status, detail) {
    const step = $(`#${id}`);
    if (!step) return;
    step.classList.remove('checking', 'pending', 'ok', 'fail');
    step.classList.add(status);
    step.querySelector('small').textContent = detail;
  }

  function setRecordButtons(enabled) {
    [$('#record-button'), $('#reading-record-button'), $('#retell-record-button')].forEach((button) => {
      button.disabled = !enabled;
    });
    const mainLabel = $('#record-button').querySelector('span');
    if (mainLabel && !state.recording) mainLabel.textContent = enabled ? '开始说话' : '完成检查后开始说话';
  }

  function setButtonLabel(button, label) {
    const labelNode = button.querySelector('span');
    if (labelNode) labelNode.textContent = label;
    else button.textContent = label;
  }

  function animateAudioMeter(stream) {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) {
      window.setTimeout(() => stream.getTracks().forEach((track) => track.stop()), 1200);
      return;
    }
    const context = new AudioContext();
    const analyser = context.createAnalyser();
    analyser.fftSize = 256;
    context.createMediaStreamSource(stream).connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);
    const bars = $$('#audio-meter i');
    const startedAt = Date.now();
    const draw = () => {
      analyser.getByteFrequencyData(data);
      const average = data.reduce((sum, value) => sum + value, 0) / data.length;
      bars.forEach((bar, index) => {
        const lift = Math.min(42, 8 + average * (.18 + (index % 4) * .035));
        bar.style.height = `${lift}px`;
      });
      if (Date.now() - startedAt < 3500) requestAnimationFrame(draw);
      else {
        bars.forEach((bar) => { bar.style.height = '8px'; });
        stream.getTracks().forEach((track) => track.stop());
        context.close().catch(() => {});
      }
    };
    draw();
  }

  async function requestMicrophone() {
    const button = $('#permission-button');
    if (!state.mediaSupported) {
      updateNotice('unavailable', '这个页面无法请求麦克风', '请使用最新版 Chrome / Edge，并通过 localhost 或 HTTPS 打开');
      return;
    }
    button.disabled = true;
    setButtonLabel(button, '等待浏览器授权…');
    setPermissionStep('permission-mic', 'checking', '等待浏览器确认');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      state.micGranted = true;
      setPermissionStep('permission-mic', 'ok', '已取得本次权限');
      try { animateAudioMeter(stream); } catch (meterError) { stream.getTracks().forEach((track) => track.stop()); }
      button.disabled = false;
      setButtonLabel(button, '重新测试麦克风');
      if (state.speechSupported) {
        setRecordButtons(true);
        updateNotice('available', '麦克风与语音识别均可用', '对着麦克风说一句话；上方音量条应随声音跳动');
      } else {
        updateNotice('unavailable', '麦克风已开启，但浏览器没有语音转文字能力', '仍可使用系统听写或粘贴文本，完整体验表达分析');
      }
    } catch (error) {
      state.micGranted = false;
      setRecordButtons(false);
      button.disabled = false;
      setButtonLabel(button, '重新检查麦克风');
      const denied = error && (error.name === 'NotAllowedError' || error.name === 'SecurityError');
      const missing = error && error.name === 'NotFoundError';
      setPermissionStep('permission-mic', 'fail', denied ? '权限被拒绝' : missing ? '未找到设备' : '检查失败');
      updateNotice('unavailable', denied ? '浏览器没有获得麦克风权限' : missing ? '没有检测到可用麦克风' : '麦克风检查没有完成', denied ? '点击地址栏左侧的权限图标，允许麦克风后再点“重新检查”' : missing ? '请连接麦克风或检查系统输入设备设置' : `浏览器返回：${error && error.name ? error.name : '未知错误'}`);
    }
  }

  function inspectStoredMicrophonePermission() {
    if (!navigator.permissions || !navigator.permissions.query) return;
    navigator.permissions.query({ name: 'microphone' }).then((permission) => {
      const reflect = () => {
        if (state.micGranted) return;
        if (permission.state === 'denied') {
          setPermissionStep('permission-mic', 'fail', '浏览器已设为拒绝');
          updateNotice('unavailable', '麦克风权限曾被拒绝', '请打开地址栏的网站权限，将麦克风改为允许后重新检查');
        } else if (permission.state === 'granted') {
          setPermissionStep('permission-mic', 'pending', '已允许，等待音量测试');
          updateNotice('neutral', '浏览器已记住麦克风权限', '点击“检查并开启麦克风”，确认设备确实有声音');
        }
      };
      reflect();
      permission.onchange = reflect;
    }).catch(() => {});
  }

  function initRecognition() {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    state.mediaSupported = Boolean(window.isSecureContext && navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
    setPermissionStep('permission-browser', state.mediaSupported ? 'ok' : 'fail', state.mediaSupported ? '安全环境可请求设备' : '需要 localhost / HTTPS');
    state.speechSupported = Boolean(Recognition);
    setPermissionStep('permission-asr', state.speechSupported ? 'ok' : 'fail', state.speechSupported ? '浏览器提供识别服务' : '当前浏览器不支持');
    setRecordButtons(false);
    inspectStoredMicrophonePermission();
    if (!state.mediaSupported) $('#permission-button').disabled = true;
    if (!Recognition) {
      updateNotice('unavailable', '当前浏览器不支持直接语音转文字', '仍可粘贴文字完整测试；最新版 Chrome / Edge 通常提供此能力');
      return;
    }
    const recognition = new Recognition();
    recognition.lang = 'zh-CN';
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 3;
    recognition.onstart = () => { state.recognitionFailed = false; setRecordingUI(true); };
    recognition.onend = () => { const failed = state.recognitionFailed; setRecordingUI(false, failed); state.recognitionFailed = false; };
    recognition.onerror = (event) => {
      state.recognitionFailed = true;
      setRecordingUI(false, true);
      const messages = {
        'not-allowed': '麦克风权限未开启，请在浏览器地址栏允许访问。',
        'service-not-allowed': '浏览器阻止了语音识别服务，请检查网站权限或改用文字输入。',
        'audio-capture': '浏览器无法读取麦克风，请检查系统输入设备。',
        'no-speech': '没有检测到清晰语音，请靠近麦克风重试。',
        'network': '浏览器语音服务连接失败，可先粘贴文字测试。',
        'language-not-supported': '当前语音服务不支持中文识别，请改用文字输入。'
      };
      if (event.error === 'not-allowed' || event.error === 'audio-capture') setPermissionStep('permission-mic', 'fail', '录音时不可用');
      if (event.error === 'service-not-allowed' || event.error === 'language-not-supported') setPermissionStep('permission-asr', 'fail', '服务不可用');
      updateNotice('unavailable', '语音输入没有完成', messages[event.error] || `识别错误：${event.error}`);
    };
    recognition.onresult = (event) => {
      const target = state.recognitionTarget;
      if (!target) return;
      let finalText = target.dataset.committed || target.value || '';
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        const transcript = result[0].transcript;
        if (result.isFinal) {
          finalText += transcript;
          target.dataset.committed = finalText;
          const confidence = Number(result[0].confidence || 0);
          if ((confidence > 0 && confidence < .72) || result.length > 1) {
            const alternatives = Array.from(result).slice(0, 3).map((alt) => alt.transcript).filter(Boolean);
            if (alternatives.length > 1) state.uncertainty.push({ original: transcript, alternatives });
          }
        } else interim += transcript;
      }
      target.value = finalText + interim;
      target.dispatchEvent(new Event('input'));
      renderUncertainty();
    };
    state.recognition = recognition;
    if (state.mediaSupported) updateNotice('neutral', '还没有开启麦克风', '先点击“检查并开启麦克风”；也可以直接输入或粘贴文字');
  }

  function setRecordingUI(recording, preserveNotice = false) {
    state.recording = recording;
    const pairs = [[$('#record-button'), '开始说话', '停止说话'], [$('#reading-record-button'), '开始朗读', '结束朗读'], [$('#retell-record-button'), '开始复述', '结束复述']];
    pairs.forEach(([button, idle, active]) => {
      button.classList.toggle('recording', recording && button === state.activeRecordButton);
      if (button === state.activeRecordButton || !recording) setButtonLabel(button, recording && button === state.activeRecordButton ? active : idle);
    });
    if (recording) updateNotice('recording', '正在听你说话', '点击结束后，请先检查可能的误识别片段');
    else if (!preserveNotice && state.recognition && state.micGranted) updateNotice('available', '本次语音输入已结束', '识别稿已保留在编辑框中，请确认后再生成报告');
  }

  function toggleRecord(target, button) {
    if (!state.micGranted) { toast('请先完成麦克风检查'); requestMicrophone(); return; }
    if (!state.recognition) { toast('当前浏览器没有语音转文字能力'); return; }
    if (state.recording) { state.recognition.stop(); return; }
    state.recognitionTarget = target;
    state.activeRecordButton = button;
    target.dataset.committed = target.value;
    try { state.recognition.start(); } catch (error) { toast('语音服务正在重置，请稍后再试'); }
  }

  function renderUncertainty() {
    const box = $('#uncertain-box');
    if (!state.uncertainty.length || state.recognitionTarget !== $('#speech-input')) { box.classList.add('hidden'); return; }
    box.classList.remove('hidden');
    $('#uncertain-list').innerHTML = state.uncertainty.slice(-3).map((item, index) => item.alternatives.map((alt) => `<button class="alternative-chip" data-uncertain="${index}" data-original="${escapeHtml(item.original)}" data-alt="${escapeHtml(alt)}" type="button">${escapeHtml(alt)}</button>`).join('')).join('');
  }

  function listGroup(label, group, count) {
    if (!count) return `<div class="habit-row"><span>${label}</span><strong>本次未发现明显重复</strong><b>0</b></div>`;
    return `<div class="habit-row"><span>${label}</span><strong>${group.slice(0, 4).map((item) => `${escapeHtml(item.term)} × ${item.count}`).join('　')}</strong><b>${count}</b></div>`;
  }

  function renderAnalysis(result) {
    state.latestAnalysis = result;
    $('#metric-fluency').textContent = `${result.fluencyScore}`;
    $('#metric-logic').textContent = `${result.structure.score}`;
    $('#metric-density').textContent = `${result.density}%`;
    $('#priority-text').textContent = result.priority[0];
    $('#habit-summary').innerHTML = [
      listGroup('语气 / 填充', result.groups.fillers, result.counts.fillers),
      listGroup('衔接词', result.groups.connectors, result.counts.connectors),
      listGroup('犹豫表达', result.groups.hedges, result.counts.hedges),
      listGroup('常用语', result.groups.habits, result.counts.habits)
    ].join('');
    const nodes = result.structure.nodes;
    $('#logic-timeline').innerHTML = nodes.length ? nodes.map((node, index) => `<div class="logic-node"><i>${index + 1}</i><div><strong>${escapeHtml(node.label)}</strong><span>识别到“${escapeHtml(node.value)}”</span></div></div>`).join('') : '<div class="logic-empty">还没有识别到明显的结论、分点、举例或总结标记。</div>';
    $('#logic-issues').innerHTML = result.structure.issues.length ? result.structure.issues.map((issue) => `<div class="issue-item">${escapeHtml(issue)}</div>`).join('') : '<div class="issue-item">结构标记完整，没有发现明显的序号缺口。</div>';
    $('#original-output').textContent = result.input;
    $('#cleanup-output').textContent = result.cleanup;
    $('#precise-suggestions').innerHTML = result.precise.length ? result.precise.slice(0, 8).map((item) => `<span class="word-suggestion"><strong>${escapeHtml(item.term)}</strong> 可根据语境改为：${item.alternatives.map(escapeHtml).join(' / ')}</span>`).join('') : '<span class="word-suggestion">本次没有强行替换用词；精准表达需要结合具体语境判断。</span>';
    $('#analysis-section').classList.remove('hidden');
    setTimeout(() => $('#analysis-section').scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
  }

  function runAnalysis() {
    const text = $('#speech-input').value.trim();
    if (A.countChineseLike(text) < 18) { toast('内容太短，请至少输入或说出 18 个字'); $('#speech-input').focus(); return; }
    renderAnalysis(A.analyze(text));
  }

  function renderSamples() {
    $('#sample-count').textContent = `${SAMPLES.length} 篇`;
    $('#sample-list').innerHTML = SAMPLES.map((sample) => `<button class="sample-card ${sample.id === state.sample.id ? 'active' : ''}" data-sample="${sample.id}" type="button"><span>${escapeHtml(sample.category)}</span><strong>${escapeHtml(sample.title)}</strong><small>${escapeHtml(sample.difficulty)} · 约 ${sample.minutes} 分钟</small></button>`).join('');
    $('#sample-tag').textContent = `${state.sample.category} · ${state.sample.difficulty}`;
    $('#sample-title').textContent = state.sample.title;
    $('#sample-meta').textContent = `约 ${A.countChineseLike(state.sample.text)} 字 · 通读约 ${state.sample.minutes} 分钟`;
    $('#sample-text').textContent = state.sample.text;
    $('#preview-text').textContent = state.sample.text;
    $('#reading-transcript').value = '';
    $('#retell-transcript').value = '';
    $('#reading-result').classList.add('hidden');
    $('#retell-result').classList.add('hidden');
    resetPreview();
  }

  function switchLevel(level) {
    $$('.level-button').forEach((button) => {
      const active = button.dataset.level === level;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    $('#level-one').classList.toggle('active', level === '1');
    $('#level-two').classList.toggle('active', level === '2');
    resetPreview();
  }

  function compareReading() {
    const spoken = $('#reading-transcript').value.trim();
    if (A.countChineseLike(spoken) < 20) { toast('请先完成一小段朗读'); return; }
    const result = A.readingComparison(state.sample.text, spoken);
    const panel = $('#reading-result');
    panel.innerHTML = `<div class="practice-score"><strong>${result.coverage}%</strong><span>内容字符覆盖估计</span></div><ul>${result.suggestions.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}<li>当前浏览器版不能读取词级音频时间戳，停顿建议基于识别稿分句，不等同于声学测评。</li></ul>`;
    panel.classList.remove('hidden');
  }

  function formatTime(seconds) { return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`; }

  function resetPreview() {
    clearInterval(state.timer);
    const seconds = Number($('#preview-duration').value || 60);
    $('#preview-timer').textContent = formatTime(seconds);
    $('#start-preview-button').textContent = '开始限时阅读';
    $('#start-preview-button').onclick = beginPreview;
    $('#preview-stage').classList.remove('hidden');
    $('#retell-stage').classList.add('hidden');
  }

  function beginPreview() {
    if (state.timer) return;
    let seconds = Number($('#preview-duration').value);
    $('#start-preview-button').textContent = '阅读中，可提前开始复述';
    $('#start-preview-button').onclick = beginRetell;
    state.timer = setInterval(() => {
      seconds -= 1;
      $('#preview-timer').textContent = formatTime(Math.max(0, seconds));
      if (seconds <= 0) beginRetell();
    }, 1000);
  }

  function beginRetell() {
    clearInterval(state.timer);
    state.timer = null;
    $('#preview-stage').classList.add('hidden');
    $('#retell-stage').classList.remove('hidden');
    $('#retell-transcript').focus();
  }

  function analyzeRetell() {
    const text = $('#retell-transcript').value.trim();
    if (A.countChineseLike(text) < 25) { toast('复述内容还太短，请再说完整一些'); return; }
    const coverage = A.keywordCoverage(state.sample.text, text, state.sample.keywords);
    const analysis = A.analyze(text);
    const score = Math.round(coverage.score * .65 + analysis.structure.score * .35);
    const panel = $('#retell-result');
    panel.innerHTML = `<div class="practice-score"><strong>${score}</strong><span>复述完成度</span></div><div class="keyword-row">${coverage.matched.map((word) => `<span class="keyword hit">已覆盖 ${escapeHtml(word)}</span>`).join('')}${coverage.missing.map((word) => `<span class="keyword miss">待补充 ${escapeHtml(word)}</span>`).join('')}</div><ul><li>关键词覆盖 ${coverage.score}%，结构评分 ${analysis.structure.score}。</li><li>${escapeHtml(analysis.priority[0])}</li><li>评分只反映范本关键词与结构标记，不判断观点对错。</li></ul>`;
    panel.classList.remove('hidden');
  }

  function readHistory() {
    try { return JSON.parse(localStorage.getItem('yuliu-history') || '[]'); } catch (error) { return []; }
  }

  function saveHistory() {
    if (!state.latestAnalysis) { toast('请先完成一次分析'); return; }
    const list = readHistory();
    const now = new Date();
    list.unshift({ id: now.getTime(), date: now.toLocaleDateString('zh-CN'), time: now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }), audience: $('#audience-select').selectedOptions[0].text, preview: state.latestAnalysis.input.slice(0, 72), chars: state.latestAnalysis.charCount, fluency: state.latestAnalysis.fluencyScore, logic: state.latestAnalysis.structure.score, priority: state.latestAnalysis.priority[0] });
    localStorage.setItem('yuliu-history', JSON.stringify(list.slice(0, 30)));
    toast('已保存到当前浏览器');
  }

  function renderHistory() {
    const list = readHistory();
    $('#history-list').innerHTML = list.length ? list.map((item) => `<article class="history-item"><div class="history-date"><span>${escapeHtml(item.date)}</span><strong>${escapeHtml(item.time)}</strong></div><div class="history-copy"><p>${escapeHtml(item.preview)}${item.preview.length >= 72 ? '…' : ''}</p><div class="history-metrics"><span>${escapeHtml(item.audience)}</span><span>${item.chars} 字</span><span>${escapeHtml(item.priority)}</span></div></div><div class="history-score"><span>流 ${item.fluency}</span><span>逻 ${item.logic}</span></div></article>`).join('') : '<div class="empty-state"><strong>还没有训练记录</strong><span>完成自由表达分析后，可以选择保存本次结果。</span></div>';
  }

  function bindEvents() {
    $$('.nav-item').forEach((button) => button.addEventListener('click', () => switchView(button.dataset.view)));
    $$('[data-jump-view]').forEach((button) => button.addEventListener('click', () => switchView(button.dataset.jumpView)));
    $('#permission-button').addEventListener('click', requestMicrophone);
    $('#speech-input').addEventListener('input', () => {
      const count = A.countChineseLike($('#speech-input').value);
      $('#input-count').textContent = `${count} 字`;
      $('#input-guidance').textContent = count === 0 ? '输入或说出至少 18 个字后，就能生成第一份表达报告。' : count < 18 ? `还差 ${18 - count} 个字。尽量说清结论、原因和下一步。` : '内容已足够：现在可以生成表达报告，查看口头禅和逻辑框架。';
    });
    $$('.session-chip').forEach((button) => button.addEventListener('click', () => {
      $$('.session-chip').forEach((item) => {
        const active = item === button;
        item.classList.toggle('active', active);
        item.setAttribute('aria-pressed', String(active));
      });
      $('#audience-select').value = button.dataset.audience;
    }));
    $$('[data-theme-choice]').forEach((button) => button.addEventListener('click', () => applyTheme(button.dataset.themeChoice)));
    $('#demo-button').addEventListener('click', () => {
      $('#speech-input').value = '嗯，我先说一下我的观点。就是我觉得这个方案可能还是有一些问题。第一点，用户进入页面以后不知道该做什么，然后第二点，就是信息有点多。第三点，我们应该尽快做一个测试。总的来说，我觉得可以先缩短流程，然后再看看结果。';
      $('#speech-input').dispatchEvent(new Event('input'));
      $('#speech-input').focus();
    });
    $('#record-button').addEventListener('click', () => toggleRecord($('#speech-input'), $('#record-button')));
    $('#reading-record-button').addEventListener('click', () => toggleRecord($('#reading-transcript'), $('#reading-record-button')));
    $('#retell-record-button').addEventListener('click', () => toggleRecord($('#retell-transcript'), $('#retell-record-button')));
    $('#analyze-button').addEventListener('click', runAnalysis);
    $('#uncertain-list').addEventListener('click', (event) => {
      const button = event.target.closest('.alternative-chip');
      if (!button) return;
      const input = $('#speech-input');
      input.value = input.value.replace(button.dataset.original, button.dataset.alt);
      input.dispatchEvent(new Event('input'));
      button.parentElement.querySelectorAll(`[data-uncertain="${button.dataset.uncertain}"]`).forEach((item) => item.disabled = true);
      button.disabled = false;
      toast('已采用你确认的识别版本');
    });
    $('#copy-cleanup-button').addEventListener('click', async () => { if (!state.latestAnalysis) return; await navigator.clipboard.writeText(state.latestAnalysis.cleanup); toast('优化稿已复制'); });
    $('#save-result-button').addEventListener('click', saveHistory);
    $('#sample-list').addEventListener('click', (event) => { const button = event.target.closest('[data-sample]'); if (!button) return; state.sample = SAMPLES.find((sample) => sample.id === button.dataset.sample); renderSamples(); });
    $$('.level-button').forEach((button) => button.addEventListener('click', () => switchLevel(button.dataset.level)));
    $('#compare-reading-button').addEventListener('click', compareReading);
    $('#preview-duration').addEventListener('change', resetPreview);
    $('#start-preview-button').onclick = beginPreview;
    $('#analyze-retell-button').addEventListener('click', analyzeRetell);
    $('#clear-history-button').addEventListener('click', () => { if (!readHistory().length) return; if (window.confirm('确定清空当前浏览器中的全部训练记录吗？')) { localStorage.removeItem('yuliu-history'); renderHistory(); toast('训练记录已清空'); } });
  }

  function applyTheme(theme, announce = true) {
    const validThemes = ['cute', 'classic', 'fresh', 'vibrant'];
    const selectedTheme = validThemes.includes(theme) ? theme : 'fresh';
    document.body.dataset.theme = selectedTheme;
    localStorage.setItem('yuliu-theme', selectedTheme);
    $$('.style-option').forEach((card) => card.classList.toggle('selected', card.classList.contains(`style-${selectedTheme}`)));
    $$('[data-theme-choice]').forEach((button) => {
      const active = button.dataset.themeChoice === selectedTheme;
      button.textContent = active ? '当前使用' : '应用这套风格';
      button.setAttribute('aria-pressed', String(active));
    });
    const colors = { cute: '#fff8f1', classic: '#f3efe6', fresh: '#f3f7f2', vibrant: '#080913' };
    const metaTheme = $('meta[name="theme-color"]');
    if (metaTheme) metaTheme.setAttribute('content', colors[selectedTheme]);
    if (announce) toast(`已切换为${{ cute: '奶油果冻', classic: '经典文稿', fresh: '清爽呼吸', vibrant: '霓虹声场' }[selectedTheme]}`);
  }

  bindEvents();
  $$('.session-chip').forEach((button) => button.setAttribute('aria-pressed', String(button.classList.contains('active'))));
  applyTheme(localStorage.getItem('yuliu-theme') || 'fresh', false);
  renderSamples();
  renderHistory();
  initRecognition();
})();
