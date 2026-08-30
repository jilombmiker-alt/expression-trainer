(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.KnowledgeBuilder = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const EDGE_STOP = '的了是在与和把被而及也都就并为对从中这那一个有会能可要';

  function clean(value) {
    return String(value || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function countChars(value) {
    return (clean(value).match(/[\u3400-\u9fffA-Za-z0-9]/g) || []).length;
  }

  function splitSentences(value) {
    const normalized = clean(value).replace(/([。！？!?；;])/g, '$1\n');
    return normalized.split(/\n+/).map((item) => item.trim()).filter((item) => countChars(item) >= 12);
  }

  function joinUntil(sentences, maxChars) {
    const selected = [];
    for (const sentence of sentences) {
      if (selected.length && countChars(selected.join('') + sentence) > maxChars) break;
      selected.push(sentence);
    }
    return selected.join('');
  }

  function phraseCandidates(value) {
    const source = clean(value).replace(/[^\u3400-\u9fff]/g, '');
    const scores = new Map();
    [4, 3, 2].forEach((length) => {
      for (let index = 0; index <= source.length - length; index += 1) {
        const phrase = source.slice(index, index + length);
        if (EDGE_STOP.includes(phrase[0]) || EDGE_STOP.includes(phrase[phrase.length - 1])) continue;
        scores.set(phrase, (scores.get(phrase) || 0) + length);
      }
    });
    return [...scores.entries()].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length).map(([phrase]) => phrase);
  }

  function conceptsFor(value, requested) {
    const explicit = clean(requested).split(/[，,、；;\s]+/).filter((item) => item.length >= 2);
    const pool = [...explicit, ...phraseCandidates(value)];
    const chosen = [];
    pool.forEach((phrase) => {
      if (chosen.length >= 4) return;
      if (chosen.some((item) => item.includes(phrase) || phrase.includes(item))) return;
      chosen.push(phrase.slice(0, 8));
    });
    if (chosen.length < 3) throw new Error('没有提取到足够的关键词，请补充3–5个关键词。');
    return chosen.map((phrase) => ({ label: phrase, terms: [phrase] }));
  }

  function centralFrom(value) {
    const sentence = splitSentences(value)[0] || clean(value);
    return sentence.length > 78 ? `${sentence.slice(0, 78)}……` : sentence;
  }

  function buildLocal(options) {
    const topic = clean(options?.topic);
    const source = clean(options?.source);
    if (!topic) throw new Error('请先填写想训练的知识主题。');
    if (countChars(source) < 220) throw new Error('资料至少需要约220个有效字，才能生成两篇不同练习。');
    const sentences = splitSentences(source);
    if (sentences.length < 4) throw new Error('资料需要至少4个完整句子，请保留句号或分号。');

    const firstPool = sentences.filter((_, index) => index % 2 === 0).concat(sentences.filter((_, index) => index % 2 === 1));
    const secondPool = sentences.filter((_, index) => index % 2 === 1).concat(sentences.filter((_, index) => index % 2 === 0));
    const firstText = joinUntil(firstPool, 210);
    const secondText = joinUntil(secondPool, 150);
    if (countChars(firstText) < 100 || countChars(secondText) < 70 || firstText === secondText) throw new Error('资料结构过于集中，暂时无法拆成两篇不同练习。');

    const sourceRef = clean(options?.sourceName, '用户在网页中提供的资料');
    return {
      id: `web-${Date.now()}`,
      title: topic,
      audience: '用户自定义',
      sourceMode: 'browser-local-preview',
      sourceRefs: [sourceRef],
      generationBoundary: '当前由浏览器规则生成，尚未经过AI语义校验。',
      rounds: [
        { mode: 'long-retell', title: `${topic} · 理解与转述`, text: firstText, central: centralFrom(firstText), concepts: conceptsFor(firstText, options?.keywords) },
        { mode: '30-second-recall', title: `${topic} · 快速抓取`, text: secondText, central: centralFrom(secondText), concepts: conceptsFor(secondText, options?.keywords) }
      ],
      challenge: {
        prepMinutes: 15,
        answerMinutes: 10,
        prompt: `请解释“${topic}”的含义、背景、机制、应用、边界与延伸。`,
        requiredDimensions: ['meaning', 'context', 'mechanism', 'application', 'boundary-counterexample', 'extension']
      }
    };
  }

  return { clean, countChars, splitSentences, buildLocal };
});
