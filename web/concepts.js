(function () {
  'use strict';

  const ICONS = {
    mic: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 17a5 5 0 0 0 5-5V7a5 5 0 0 0-10 0v5a5 5 0 0 0 5 5Zm0 0v4m-4 0h8M4 12a8 8 0 0 0 16 0"/></svg>',
    arrow: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>',
    check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>',
    spark: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 2 1.7 5.3L19 9l-5.3 1.7L12 16l-1.7-5.3L5 9l5.3-1.7L12 2Zm6 13 .8 2.2L21 18l-2.2.8L18 21l-.8-2.2L15 18l2.2-.8L18 15Z"/></svg>'
  };

  const DEMO = '先说结论，我建议把本次活动提前一周开始预热。嗯，第一点，现在用户对活动规则还不够了解，我们需要用三张简单的图把参与方式讲清楚。第二点，就是内容发布得太集中，可能很难形成持续讨论，所以我建议分三次发布。第三点，我们可以邀请老用户分享真实体验。举个例子，上次一位用户的短视频带来了很多自然咨询。总的来说，提前预热、分批发布，再加入用户故事，会让这次活动更容易被理解和传播。';

  const CONCEPTS = {
    editorial: {
      no: '01', name: '表达训练器', tone: 'EDITORIAL VOICE COACH',
      headline: '你的表达，\n值得被认真听见。',
      sub: '留一点时间给思考，也留一点空间给停顿。说完一段真实的话，我们只帮你看清习惯、结构和下一步。',
      note: '成熟、温暖、像一本会回应你的练习手册。'
    },
    pixel: {
      no: '02', name: '像素脉冲', tone: 'SPEECH SYSTEM / LIVE',
      headline: 'SPEAK\nCLEARER.',
      sub: '输入、识别、拆解、升级。每一次停顿和连接词都会变成可以看见的数据。移动鼠标，感受像素反馈。',
      note: '高记忆点、年轻、像一台表达训练仪。'
    },
    wave: {
      no: '03', name: '语义流光', tone: 'AI VOICE INTELLIGENCE',
      headline: '让每一次开口，\n更有方向。',
      sub: '把声音放进流动的语义场：先确认原话，再看见逻辑路线，最后只修改最值得先练的一件事。',
      note: '沉浸、流动、强调 AI 与语音的实时感。'
    },
    product: {
      no: '04', name: '清晰工作台', tone: 'PRACTICE WORKSPACE',
      headline: '今天，把一件事\n讲清楚。',
      sub: '选一个真实场景，输入或说出 60 秒内容。系统会标记口头习惯，识别“第一点、第二点”，并给出一条练习建议。',
      note: '最容易理解、最接近可直接上线的产品结构。'
    }
  };

  const SCENARIOS = {
    work: ['工作汇报', '建议：先说结论，再用第一点、第二点展开。'],
    interview: ['面试表达', '建议：按背景、行动、结果讲清你的贡献。'],
    creator: ['内容创作', '建议：先抛观点，再给例子，最后收束。'],
    daily: ['日常沟通', '建议：说明事实、感受和明确需求。']
  };

  const app = document.getElementById('concept-app');
  if (!app) {
    document.querySelectorAll('.concept-card').forEach((card) => {
      card.addEventListener('pointermove', (event) => {
        const box = card.getBoundingClientRect();
        card.style.setProperty('--mx', `${event.clientX - box.left}px`);
        card.style.setProperty('--my', `${event.clientY - box.top}px`);
      });
    });
    return;
  }

  const conceptKey = document.body.dataset.concept;
  const concept = CONCEPTS[conceptKey] || CONCEPTS.product;
  const routes = Object.entries(CONCEPTS).map(([key, item]) => `<a href="concept-${key}.html" class="${key === conceptKey ? 'active' : ''}" aria-current="${key === conceptKey ? 'page' : 'false'}"><span>${item.no}</span>${item.name}</a>`).join('');

  app.innerHTML = `
    <header class="concept-nav">
      <a class="wordmark" href="index.html"><span>Y</span>语流 <small>AI 表达训练</small></a>
      <nav aria-label="切换设计方案">${routes}</nav>
      <a class="all-concepts" href="index.html">四版总览</a>
    </header>
    <main id="main">
      <section class="concept-hero">
        <div class="hero-copy">
          <p class="micro-label">${concept.tone} · CONCEPT ${concept.no}</p>
          <h1>${concept.headline.replace(/\n/g, '<br>')}</h1>
          <p class="hero-sub">${concept.sub}</p>
          <a class="hero-cta" href="#trainer">开始一次练习 ${ICONS.arrow}</a>
          <small>${concept.note}</small>
        </div>
        <div class="hero-art" aria-label="表达分析预览">
          <div class="orb"><span></span><i></i><i></i><i></i></div>
          <div class="floating-score score-a"><span>逻辑结构</span><strong>84</strong><small>识别到 3 个分点</small></div>
          <div class="floating-score score-b"><span>口头习惯</span><strong>2×</strong><small>“就是”出现 2 次</small></div>
          <div class="signal-line"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div>
        </div>
      </section>

      <section id="trainer" class="trainer-shell" aria-labelledby="trainer-title">
        <div class="trainer-heading">
          <div><p class="micro-label">TRY IT NOW / 无需登录</p><h2 id="trainer-title">先用一段真实表达试试</h2></div>
          <p>基础分析在浏览器本地完成；麦克风只有点击按钮后才请求权限。</p>
        </div>
        <div class="scenario-row" role="group" aria-label="训练场景">
          ${Object.entries(SCENARIOS).map(([key, item], index) => `<button type="button" data-scenario="${key}" class="${index === 0 ? 'active' : ''}"><span>0${index + 1}</span>${item[0]}</button>`).join('')}
        </div>
        <div class="workbench">
          <section class="input-panel">
            <div class="panel-top"><div><span>INPUT</span><h3>说出或粘贴你的原话</h3></div><button id="demo" class="text-action" type="button">填入示例</button></div>
            <p id="scenario-hint" class="scenario-hint">${SCENARIOS.work[1]}</p>
            <label for="speech-input">表达内容</label>
            <textarea id="speech-input" rows="9" maxlength="8000" placeholder="可以从这里开始：先说结论……第一点……第二点……"></textarea>
            <div class="input-meta"><span id="count">0 字</span><span>建议 60–180 秒</span></div>
            <div id="mic-status" class="mic-status" role="status" aria-live="polite"><i></i><span><b>文字体验已就绪</b><small>也可以检查麦克风后直接说话</small></span></div>
            <div class="action-row">
              <button id="mic" class="secondary-action" type="button">${ICONS.mic}<span>检查麦克风</span></button>
              <button id="analyze" class="primary-action" type="button"><span>生成表达报告</span>${ICONS.arrow}</button>
            </div>
            <p class="privacy-note">不会在本页保存录音。浏览器自带语音识别可能联网处理音频；你可以先修改识别稿再分析。</p>
          </section>
          <aside class="method-panel">
            <span class="method-index">METHOD / 04</span>
            <h3>我们怎样看一段表达</h3>
            <ol>
              <li><i>1</i><div><b>先确认原话</b><p>识别错了先改，不让错误文本直接进入分析。</p></div></li>
              <li><i>2</i><div><b>区分语言习惯</b><p>衔接词、语气助词、常用语和口头禅分开看。</p></div></li>
              <li><i>3</i><div><b>识别逻辑路线</b><p>找出结论、第一点、第二点、例子和总结。</p></div></li>
              <li><i>4</i><div><b>只给一个动作</b><p>一次只练最值得先改的一件事。</p></div></li>
            </ol>
          </aside>
        </div>
      </section>

      <section id="results" class="results" aria-labelledby="results-title" hidden>
        <div class="result-title"><p class="micro-label">YOUR REPORT / 本地分析</p><h2 id="results-title">这段话，已经被拆清楚了。</h2></div>
        <div class="metric-row">
          <article><span>表达流畅度</span><strong id="fluency">--</strong><small>/ 100</small></article>
          <article><span>逻辑结构</span><strong id="logic">--</strong><small>/ 100</small></article>
          <article><span>有效密度</span><strong id="density">--</strong><small>/ 100</small></article>
          <article class="priority"><span>下一轮只练这个</span><p id="priority">--</p></article>
        </div>
        <div class="result-cards">
          <article><span class="result-no">01</span><h3>语言习惯</h3><div id="habits" class="habits"></div></article>
          <article><span class="result-no">02</span><h3>逻辑路线</h3><div id="logic-route" class="logic-route"></div></article>
          <article class="cleanup"><span class="result-no">03</span><h3>忠实清理</h3><p id="cleanup"></p><button id="copy" type="button">复制清理稿</button></article>
        </div>
      </section>
    </main>
    <footer class="concept-footer"><a href="index.html">YULIU / 语流</a><p>先忠实记录，再帮助你讲清楚。</p><span>CONCEPT ${concept.no} / 04</span></footer>`;

  const input = document.getElementById('speech-input');
  const count = document.getElementById('count');
  const micButton = document.getElementById('mic');
  const micStatus = document.getElementById('mic-status');
  let recognition = null;
  let isRecording = false;

  function updateCount() { count.textContent = `${window.ExpressionAnalyzer.countChineseLike(input.value)} 字`; }
  input.addEventListener('input', updateCount);
  document.getElementById('demo').addEventListener('click', () => { input.value = DEMO; updateCount(); input.focus(); });
  document.querySelectorAll('[data-scenario]').forEach((button) => {
    button.addEventListener('click', () => {
      document.querySelectorAll('[data-scenario]').forEach((item) => item.classList.toggle('active', item === button));
      document.getElementById('scenario-hint').textContent = SCENARIOS[button.dataset.scenario][1];
    });
  });

  micButton.addEventListener('click', async () => {
    if (recognition && isRecording) { recognition.stop(); return; }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      micStatus.className = 'mic-status error';
      micStatus.innerHTML = '<i></i><span><b>当前环境不能调用麦克风</b><small>仍可直接输入文字完成全部分析</small></span>';
      return;
    }
    try {
      micButton.disabled = true;
      micButton.querySelector('span').textContent = '正在请求权限…';
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SpeechRecognition) {
        micStatus.className = 'mic-status ready';
        micStatus.innerHTML = '<i></i><span><b>麦克风权限已开启</b><small>此浏览器没有实时中文转写，可录音后粘贴文字</small></span>';
        micButton.querySelector('span').textContent = '权限已开启';
        return;
      }
      recognition = new SpeechRecognition();
      recognition.lang = 'zh-CN'; recognition.continuous = true; recognition.interimResults = true;
      let committed = input.value ? `${input.value} ` : '';
      recognition.onresult = (event) => {
        let interim = '';
        for (let i = event.resultIndex; i < event.results.length; i += 1) {
          const value = event.results[i][0].transcript;
          if (event.results[i].isFinal) committed += value;
          else interim += value;
        }
        input.value = committed + interim; updateCount();
      };
      recognition.onend = () => { isRecording = false; micButton.querySelector('span').textContent = '继续说话'; micStatus.querySelector('b').textContent = '录音已暂停，可先修改识别稿'; };
      recognition.start(); isRecording = true;
      micStatus.className = 'mic-status listening';
      micStatus.innerHTML = '<i></i><span><b>正在听你说话</b><small>识别结果会实时出现在输入框，可随时暂停修改</small></span>';
      micButton.querySelector('span').textContent = '暂停识别';
    } catch (error) {
      micStatus.className = 'mic-status error';
      micStatus.innerHTML = '<i></i><span><b>没有获得麦克风权限</b><small>请在浏览器地址栏重新允许，或直接输入文字</small></span>';
      micButton.querySelector('span').textContent = '重新检查';
    } finally { micButton.disabled = false; }
  });

  function renderHabits(result) {
    const labels = { fillers: '语气 / 填充', connectors: '衔接词', hedges: '犹豫表达', habits: '常用语' };
    const items = Object.entries(result.groups).flatMap(([key, values]) => values.slice(0, 3).map((item) => `<span><i>${labels[key]}</i><b>${item.term}</b><em>${item.count} 次</em></span>`));
    return items.length ? items.join('') : '<p>没有发现明显的高频口头习惯。</p>';
  }

  document.getElementById('analyze').addEventListener('click', () => {
    const length = window.ExpressionAnalyzer.countChineseLike(input.value);
    if (length < 18) {
      input.setAttribute('aria-invalid', 'true'); input.focus();
      micStatus.className = 'mic-status error';
      micStatus.innerHTML = '<i></i><span><b>内容还不够分析</b><small>请至少输入 18 个字，或点击“填入示例”</small></span>';
      return;
    }
    input.removeAttribute('aria-invalid');
    const result = window.ExpressionAnalyzer.analyze(input.value);
    document.getElementById('fluency').textContent = result.fluencyScore;
    document.getElementById('logic').textContent = result.structure.score;
    document.getElementById('density').textContent = result.density;
    document.getElementById('priority').textContent = result.priority[0];
    document.getElementById('habits').innerHTML = renderHabits(result);
    document.getElementById('logic-route').innerHTML = result.structure.nodes.length
      ? result.structure.nodes.map((node, index) => `<span><i>${String(index + 1).padStart(2, '0')}</i><b>${node.label}</b><small>${node.value}</small></span>`).join('')
      : '<p>暂时没有识别到明确框架。试着加入“先说结论、第一点、第二点”。</p>';
    document.getElementById('cleanup').textContent = result.cleanup;
    const results = document.getElementById('results'); results.hidden = false; results.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  });

  document.getElementById('copy').addEventListener('click', async (event) => {
    try { await navigator.clipboard.writeText(document.getElementById('cleanup').textContent); event.currentTarget.textContent = '已复制'; }
    catch (_) { event.currentTarget.textContent = '请手动复制'; }
  });

  if (conceptKey === 'pixel') initPixelTrail();
  if (conceptKey === 'wave') initWaveField();

  function initPixelTrail() {
    const canvas = document.getElementById('pixel-trail'); if (!canvas || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const ctx = canvas.getContext('2d'); const cells = []; const size = 18;
    function resize() { canvas.width = innerWidth * devicePixelRatio; canvas.height = innerHeight * devicePixelRatio; ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0); }
    addEventListener('resize', resize); resize();
    addEventListener('pointermove', (event) => { cells.push({ x: Math.round(event.clientX / size) * size, y: Math.round(event.clientY / size) * size, life: 1 }); if (cells.length > 55) cells.shift(); });
    function draw() { ctx.clearRect(0, 0, innerWidth, innerHeight); cells.forEach((cell) => { ctx.fillStyle = `rgba(203,255,75,${cell.life * .65})`; ctx.fillRect(cell.x - size / 2, cell.y - size / 2, size - 2, size - 2); cell.life -= .026; }); for (let i = cells.length - 1; i >= 0; i -= 1) if (cells[i].life <= 0) cells.splice(i, 1); requestAnimationFrame(draw); } draw();
  }

  function initWaveField() {
    const canvas = document.getElementById('wave-field'); if (!canvas) return; const ctx = canvas.getContext('2d'); let t = 0; const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    function resize() { canvas.width = innerWidth * devicePixelRatio; canvas.height = innerHeight * devicePixelRatio; ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0); } addEventListener('resize', resize); resize();
    function draw() { ctx.clearRect(0, 0, innerWidth, innerHeight); for (let line = 0; line < 8; line += 1) { ctx.beginPath(); for (let x = -20; x <= innerWidth + 20; x += 14) { const y = innerHeight * .38 + line * 19 + Math.sin(x * .007 + t + line * .45) * (42 + line * 3); if (x < 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); } ctx.strokeStyle = `rgba(${92 + line * 8},${116 + line * 5},255,${.23 - line * .015})`; ctx.lineWidth = 1.2; ctx.stroke(); } if (!reduced) { t += .006; requestAnimationFrame(draw); } } draw();
  }
})();
