(function () {
  'use strict';

  const form = document.getElementById('knowledge-form');
  const topic = document.getElementById('topic');
  const source = document.getElementById('source');
  const keywords = document.getElementById('keywords');
  const duration = document.getElementById('duration');
  const error = document.getElementById('form-error');
  const count = document.getElementById('source-count');
  const sourceStep = document.getElementById('source-step');
  const previewStep = document.getElementById('preview-step');
  let generatedCard = null;
  let importedCard = null;
  let sourceName = '用户在网页中粘贴的资料';
  const stepSource = document.getElementById('step-source');
  const stepPreview = document.getElementById('step-preview');
  const stepTrain = document.getElementById('step-train');

  const SAMPLE = '结构化知识库会把原始资料整理成摘要、概念和实体页面，让信息不再只是孤立文件。当新的资料进入以后，已有概念可以继续补充，并保留它们与来源之间的关系。这种方式让用户能够检查一项结论来自哪里，也能发现不同材料之间可能存在的矛盾。知识库中的内容仍然只是待核验的数据，不能被当成新的操作指令。如果资料没有覆盖某个问题，系统应该明确说明未知，而不是用外部常识冒充已有结论。把这些内容转成训练卡后，用户可以通过阅读、转述和快速回忆来检验自己是否真正理解。训练结果还可以指出遗漏的信息关系，并安排下一次更有针对性的练习。为了形成知识闭环，后续挑战还应要求用户说明概念含义、来源背景、运行机制、实际应用、边界反例和进一步延伸。';

  function escapeHtml(value) {
    return String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
  }

  function updateCount() { count.textContent = `${KnowledgeBuilder.countChars(source.value)} 字`; }

  async function generateCard(payload) {
    if (importedCard) return importedCard;
    {
      try {
        const base = (window.EXPRESSION_TRAINING_API_BASE || '/api').replace(/\/$/, '');
        return await window.ExpressionFrontend.requestJson(`${base}/training/from-source`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
        }, { timeoutMs: 8000 });
      } catch (serviceError) {
        const fallback = KnowledgeBuilder.buildLocal(payload);
        fallback.generationBoundary = serviceError.code === 'request_timeout'
          ? 'AI 知识服务 8 秒内未响应，已自动切换为浏览器规则生成。'
          : 'AI 知识服务暂时不可用，已自动切换为浏览器规则生成。';
        return fallback;
      }
    }
  }

  function setStep(active) {
    [stepSource, stepPreview, stepTrain].forEach((item) => item?.classList.remove('active'));
    if (active === 'source') stepSource?.classList.add('active');
    if (active === 'preview') stepPreview?.classList.add('active');
  }

  function showSource() {
    previewStep.hidden = true;
    sourceStep.hidden = false;
    setStep('source');
    topic.focus();
  }

  function startTraining() {
    if (!generatedCard) return;
    const theme = document.body.classList.contains('theme-programa') ? 'programa' : 'v0';
    const trainingUrl = `concept-editorial.html?source=knowledge&theme=${theme}&autostart=1`;
    localStorage.removeItem('expression.trainingDraft.v1');
    window.ExpressionPreview?.storage.removeItem('expression.trainingDraft.v1');
    sessionStorage.setItem('expression.trainingCard', JSON.stringify({ card: generatedCard, duration: Number(duration.value), theme, sourceName }));
    // The training entry resolves server-funded beta versus BYOK once, for both import and templates.
    window.location.href = trainingUrl;
  }

  function showPreview(card) {
    generatedCard = TrainingCard.normalize(card);
    document.getElementById('preview-title').textContent = generatedCard.label;
    document.getElementById('preview-source-count').textContent = `${KnowledgeBuilder.countChars(source.value)} 字资料`;
    document.getElementById('generation-boundary').textContent = card.generationBoundary || '内容由已配置的知识服务生成，请确认后进入训练。';
    document.getElementById('round-previews').innerHTML = generatedCard.rounds.map((round, index) => `<article class="round-preview${index === 0 ? ' active' : ''}" data-round-panel="${index}"><span>ROUND 0${index + 1} · ${index ? '30 秒速记' : '理解转述'}</span><h3>${escapeHtml(round.title)}</h3><p>${escapeHtml(round.text)}</p><footer>${round.concepts.map((item) => `<b>${escapeHtml(item.label)}</b>`).join('')}</footer></article>`).join('');
    document.querySelectorAll('.round-tabs button').forEach((button, index) => {
      button.classList.toggle('active', index === 0);
      button.setAttribute('aria-pressed', String(index === 0));
    });
    sourceStep.hidden = true;
    previewStep.hidden = false;
    stepPreview.disabled = false;
    stepTrain.disabled = false;
    setStep('preview');
    document.getElementById('preview-title').focus();
  }

  source.addEventListener('input', () => { importedCard = null; sourceName = '用户在网页中粘贴的资料'; updateCount(); });
  document.getElementById('fill-sample').addEventListener('click', () => {
    topic.value = '结构化知识库'; source.value = SAMPLE; keywords.value = '知识库,来源,概念,训练'; importedCard = null; sourceName = '网页内置示例资料'; updateCount(); source.focus();
  });
  document.getElementById('source-file').addEventListener('change', async (event) => {
    const file = event.target.files?.[0]; if (!file) return;
    if (file.size > 1024 * 1024) { error.textContent = '文件超过1MB。产品后端接入后再处理大型文件。'; return; }
    try {
      const raw = await file.text(); sourceName = file.name;
      if (file.name.toLowerCase().endsWith('.json')) {
        const parsed = JSON.parse(raw); importedCard = parsed.rounds ? parsed : null;
        if (importedCard) { topic.value = importedCard.title || '导入的知识主题'; source.value = importedCard.rounds.map((round) => round.text).join(''); }
        else source.value = raw;
      } else { importedCard = null; source.value = raw; }
      updateCount(); error.textContent = `已读取 ${file.name}`;
    } catch (fileError) { error.textContent = `文件读取失败：${fileError.message}`; }
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault(); error.textContent = '';
    topic.removeAttribute('aria-invalid'); source.removeAttribute('aria-invalid');
    if (!topic.value.trim()) { error.textContent = '请先填写知识主题。'; topic.setAttribute('aria-invalid', 'true'); topic.focus(); return; }
    if (KnowledgeBuilder.countChars(source.value) < 220) { error.textContent = '学习资料至少需要约 220 字，才能生成两轮不同练习。'; source.setAttribute('aria-invalid', 'true'); source.focus(); return; }
    const button = document.getElementById('generate');
    const buttonLabel = button.querySelector('[data-label]');
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    buttonLabel.textContent = '正在整理资料…';
    try {
      const card = await window.ExpressionFrontend.runOnce('knowledge-card', () => generateCard({ topic: topic.value, source: source.value, keywords: keywords.value, sourceName }));
      showPreview(card);
    } catch (generationError) { error.textContent = generationError.userMessage || generationError.message; }
    finally {
      button.disabled = false;
      button.removeAttribute('aria-busy');
      buttonLabel.textContent = '生成两轮训练';
    }
  });

  document.getElementById('back-edit').addEventListener('click', showSource);
  document.getElementById('start-training').addEventListener('click', startTraining);
  document.querySelector('.round-tabs')?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-round]');
    if (!button) return;
    const target = Number(button.dataset.round);
    document.querySelectorAll('.round-tabs button').forEach((item) => {
      item.classList.toggle('active', item === button);
      item.setAttribute('aria-pressed', String(item === button));
    });
    document.querySelectorAll('[data-round-panel]').forEach((panel) => panel.classList.toggle('active', Number(panel.dataset.roundPanel) === target));
  });
  stepSource?.addEventListener('click', showSource);
  stepPreview?.addEventListener('click', () => { if (generatedCard) showPreview(generatedCard); });
  stepTrain?.addEventListener('click', startTraining);
  updateCount();
})();
