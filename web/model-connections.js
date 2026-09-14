(function () {
  'use strict';
  const Frontend = window.ExpressionFrontend;
  const storageKey = 'expression.modelConnection.v1';
  const returnKey = 'expression.afterModelConnect.v1';
  const query = new URLSearchParams(window.location.search);
  const theme = query.get('theme') === 'programa' ? 'programa' : 'v0';
  const form = document.getElementById('connection-form');
  const provider = document.getElementById('provider');
  const model = document.getElementById('model');
  const apiKey = document.getElementById('api-key');
  const providerNote = document.getElementById('provider-note');
  const message = document.getElementById('form-message');
  const connectButton = document.getElementById('connect');
  const disconnectButton = document.getElementById('disconnect');
  const stateBadge = document.getElementById('connection-state');
  const summary = document.getElementById('connected-summary');
  const returnButton = document.getElementById('return-after-connect');
  let providers = [];
  let pendingConnectionId = '';
  let sponsored = false;

  function getStoredId() { try { return sessionStorage.getItem(storageKey) || ''; } catch (_) { return ''; } }
  function setStoredId(value) { try { if (value) sessionStorage.setItem(storageKey, value); else sessionStorage.removeItem(storageKey); } catch (_) {} }
  function setStatus(kind, text) {
    stateBadge.className = kind === 'ready' ? 'state-ready' : kind === 'error' ? 'state-error' : 'state-idle';
    stateBadge.textContent = text;
  }
  function setMessage(text, kind = '') { message.textContent = text; message.className = `form-error ${kind}`.trim(); }
  function getReturnUrl() {
    let raw = '';
    try { raw = sessionStorage.getItem(returnKey) || ''; } catch (_) {}
    if (!raw) return '';
    try {
      const target = new URL(raw, window.location.origin);
      return target.origin === window.location.origin && target.pathname.endsWith('.html') ? `${target.pathname.split('/').pop()}${target.search}` : '';
    } catch (_) { return ''; }
  }
  function updateProviderNote() {
    const selected = providers.find((item) => item.id === provider.value);
    providerNote.textContent = selected ? selected.modelHint : '';
    if (selected) apiKey.placeholder = selected.keyHint;
  }
  function showConnected(data) {
    setStatus('ready', '已接入');
    disconnectButton.hidden = false;
    summary.hidden = false;
    summary.replaceChildren();
    const title = document.createElement('b');
    title.textContent = `${data.providerLabel} · ${data.model}`;
    summary.append(title, document.createTextNode(`密钥 ${data.maskedKey} · 本次浏览会话有效，过期后需要重新填写。`));
    if (returnButton) returnButton.hidden = !getReturnUrl();
  }
  function showDisconnected() {
    setStatus('idle', '未接入');
    disconnectButton.hidden = true;
    summary.hidden = true;
    if (returnButton) returnButton.hidden = true;
  }
  async function loadProviders() {
    const data = await Frontend.requestJson('/api/model-connections/providers');
    providers = data.providers || [];
    provider.replaceChildren(...providers.map((item) => {
      const option = document.createElement('option'); option.value = item.id; option.textContent = item.label; return option;
    }));
    updateProviderNote();
  }
  async function restore() {
    const connectionId = getStoredId();
    if (!connectionId) return showDisconnected();
    try {
      const data = await Frontend.requestJson(`/api/model-connections/${encodeURIComponent(connectionId)}`);
      pendingConnectionId = connectionId;
      showConnected(data);
    } catch (_) {
      setStoredId('');
      showDisconnected();
      setMessage('上次模型连接已经失效，请重新接入。');
    }
  }
  provider.addEventListener('change', updateProviderNote);
  document.getElementById('toggle-secret').addEventListener('click', (event) => {
    const showing = apiKey.type === 'text';
    apiKey.type = showing ? 'password' : 'text';
    event.currentTarget.textContent = showing ? '显示' : '隐藏';
    event.currentTarget.setAttribute('aria-label', showing ? '显示 API Key' : '隐藏 API Key');
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (sponsored || window.ExpressionPreview) return;
    if (!provider.value || !model.value.trim() || !apiKey.value.trim()) {
      setStatus('error', '待补充');
      setMessage('请完整填写模型厂商、模型名称和 API Key。', 'error');
      return;
    }
    connectButton.disabled = true;
    disconnectButton.disabled = true;
    setStatus('idle', '正在测试');
    setMessage('正在用你的密钥发起一次最小测试请求…');
    try {
      if (pendingConnectionId) await Frontend.requestJson(`/api/model-connections/${encodeURIComponent(pendingConnectionId)}`, { method: 'DELETE' });
      const connection = await Frontend.requestJson('/api/model-connections', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: provider.value, model: model.value.trim(), apiKey: apiKey.value.trim() })
      });
      pendingConnectionId = connection.connectionId;
      await Frontend.requestJson(`/api/model-connections/${encodeURIComponent(connection.connectionId)}/test`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }, { timeoutMs: 45000 });
      setStoredId(connection.connectionId);
      apiKey.value = '';
      showConnected(connection);
      setMessage('连接成功。之后的 AI 语义分析会使用你的模型。', 'success');
    } catch (error) {
      setStoredId('');
      setStatus('error', '连接失败');
      setMessage(error.userMessage || error.message || '连接失败，请核对信息。', 'error');
    } finally {
      connectButton.disabled = false;
      disconnectButton.disabled = false;
    }
  });
  disconnectButton.addEventListener('click', async () => {
    const connectionId = pendingConnectionId || getStoredId();
    disconnectButton.disabled = true;
    try { if (connectionId) await Frontend.requestJson(`/api/model-connections/${encodeURIComponent(connectionId)}`, { method: 'DELETE' }); } catch (_) {}
    pendingConnectionId = '';
    setStoredId('');
    showDisconnected();
    setMessage('已断开。开始新的训练前需要重新接入模型。');
    disconnectButton.disabled = false;
  });
  returnButton?.addEventListener('click', () => {
    const target = getReturnUrl() || `concept-editorial.html?theme=${theme}`;
    try { sessionStorage.removeItem(returnKey); } catch (_) {}
    window.location.href = target;
  });
  (async () => {
    document.body.className = `theme-${theme} settings-page`;
    const trainingUrl = `concept-editorial.html?theme=${theme}`;
    ['settings-brand', 'settings-back', 'footer-back'].forEach((id) => { const link = document.getElementById(id); if (link) link.href = trainingUrl; });
    if (theme === 'programa') {
      document.getElementById('settings-brand-subtitle').textContent = '设置';
      document.querySelector('#settings-brand svg').innerHTML = '<circle cx="10" cy="10" r="5"/><circle cx="10" cy="22" r="5"/><path d="M17 5h10l-7 7h-3zM17 17h10l-7 7h-3z"/>';
    }
    if (query.get('required') === '1') document.getElementById('settings-reason').textContent = '开始训练前，请先接入你自己的模型。接入成功后可以继续刚才选择的内容。';
    if (window.ExpressionPreview) {
      document.querySelector('.screen-intro h1').textContent = '先体验训练，无需填写密钥。';
      document.getElementById('settings-reason').textContent = '当前为前端测试版：选题、导入文字、两轮练习和本机成长记录可用。AI 语义判断、高精度转录及云端后台尚未接通。';
      document.querySelector('.feature-list').hidden = true;
      form.querySelectorAll('.field').forEach((item) => { item.hidden = true; });
      form.querySelectorAll('input,select,button').forEach((item) => { item.disabled = true; });
      connectButton.hidden = true; disconnectButton.hidden = true;
      setStatus('idle', '前端测试版');
      summary.hidden = false; summary.textContent = '不用提交 API Key。浏览器语音识别是否可用取决于设备与网络；识别不可用时可以输入文字完成流程。';
      setMessage('本地评分仅用于体验，不是经过 AI 核验的能力测评。');
      if (returnButton) { returnButton.hidden = false; returnButton.disabled = false; returnButton.textContent = '返回训练 →'; }
      document.querySelector('.app-footer > span').textContent = '前端测试 · 不收集模型密钥 · 记录仅保存在本机';
      return;
    }
    try {
      const health = await Frontend.requestJson('/api/semantic/health');
      sponsored = health.billingMode === 'sponsored' && health.byokRequired === false;
      if (sponsored) {
        document.querySelector('.screen-intro h1').textContent = '内测模型已由维护者提供。';
        document.getElementById('settings-reason').textContent = '你不需要填写 API Key。训练会使用维护者的模型额度，并受每日调用次数限制。';
        document.querySelector('.feature-list').hidden = true;
        form.querySelectorAll('.field').forEach((item) => { item.hidden = true; });
        form.querySelectorAll('input,select').forEach((item) => { item.disabled = true; });
        connectButton.hidden = true; disconnectButton.hidden = true;
        setStatus(health.available ? 'ready' : 'error', health.available ? '内测模型已接入' : '内测模型未就绪');
        summary.hidden = false; summary.textContent = `当前模型：${health.model || '待配置'}。密钥仅在后端使用，不提供给访问者。`;
        setMessage('费用由维护者承担；达到内测上限时会暂停 AI 分析。');
        if (returnButton) { returnButton.hidden = false; returnButton.textContent = '返回训练 →'; }
        document.querySelector('.app-footer > span').textContent = '内测模式 · 模型由维护者提供';
        return;
      }
      await loadProviders(); await restore();
    }
    catch (error) { setStatus('error', '服务不可用'); setMessage(error.userMessage || '暂时无法读取模型接入服务。', 'error'); }
  })();
})();
