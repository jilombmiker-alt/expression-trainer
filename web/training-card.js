(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TrainingCard = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function text(value, fallback) {
    const normalized = String(value || fallback || '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim();
    return normalized;
  }

  function normalizeConcept(value, index) {
    const label = text(value?.label, `信息点 ${index + 1}`);
    const terms = Array.isArray(value?.terms) ? value.terms.map((term) => text(term)).filter(Boolean).slice(0, 12) : [];
    if (!terms.length) terms.push(label);
    return { label, terms };
  }

  function normalizeRound(value, index) {
    const body = text(value?.text);
    if (body.length < 60) throw new Error(`第 ${index + 1} 轮文章至少需要 60 个字。`);
    const central = text(value?.central);
    if (!central) throw new Error(`第 ${index + 1} 轮缺少中心思想。`);
    const concepts = Array.isArray(value?.concepts) ? value.concepts.slice(0, 5).map(normalizeConcept) : [];
    if (concepts.length < 3) throw new Error(`第 ${index + 1} 轮至少需要 3 个关键信息组。`);
    return { title: text(value?.title, index ? '30 秒关键信息练习' : '知识理解练习'), text: body, central, concepts };
  }

  function normalize(input) {
    if (!input || typeof input !== 'object') throw new Error('训练卡必须是 JSON 对象。');
    if (!Array.isArray(input.rounds) || input.rounds.length < 2) throw new Error('训练卡必须包含两轮不同文章。');
    const title = text(input.title || input.label, '我的知识主题');
    const sourceRefs = Array.isArray(input.sourceRefs) ? input.sourceRefs.map((item) => text(item)).filter(Boolean).slice(0, 12) : [];
    const challenge = input.challenge && typeof input.challenge === 'object' ? input.challenge : null;
    const knowledge = input.knowledge && typeof input.knowledge === 'object' ? input.knowledge : null;
    return {
      id: 'knowledge', label: title.slice(0, 18), title,
      sourceMode: text(input.sourceMode, 'supplied-file'), sourceRefs, knowledge, challenge,
      generationBoundary: text(input.generationBoundary), generator: text(input.generator),
      rounds: [normalizeRound(input.rounds[0], 0), normalizeRound(input.rounds[1], 1)]
    };
  }

  return { normalize };
});
