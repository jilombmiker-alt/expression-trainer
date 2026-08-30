(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ExpressionAnalyzer = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const GROUPS = {
    fillers: ['嗯', '啊', '呃', '额', '那个', '这个', '就是', '然后', '然后呢', '就是说', '怎么说呢', '你知道', '对吧', '是吧', '所以说'],
    connectors: ['第一点', '第二点', '第三点', '首先', '其次', '再次', '最后', '另外', '同时', '不过', '但是', '因为', '所以', '因此', '总之', '总的来说', '换句话说', '具体来说', '举个例子'],
    hedges: ['可能', '也许', '大概', '应该', '我觉得', '我感觉', '好像', '似乎', '或许', '不一定', '差不多', '算是', '某种程度上'],
    habits: ['其实', '基本上', '反正', '说实话', '坦白讲', '相对来说', '本质上', '某种意义上', '大家都知道', '我个人认为']
  };

  const STRUCTURE_RULES = [
    { key: 'conclusion', label: '结论先行', level: 0, pattern: /(先说结论|我的结论|我的观点|核心是|关键是|我想表达的是)/g },
    { key: 'point1', label: '第一点', level: 1, pattern: /(第一(?:点|个)?|首先|一是)/g },
    { key: 'point2', label: '第二点', level: 2, pattern: /(第二(?:点|个)?|其次|二是)/g },
    { key: 'point3', label: '第三点', level: 3, pattern: /(第三(?:点|个)?|再次|三是)/g },
    { key: 'example', label: '例子 / 证据', level: 4, pattern: /(例如|比如|举个例子|具体来看|数据显示|以.+为例)/g },
    { key: 'closing', label: '总结收束', level: 5, pattern: /(最后|总的来说|综上|归根结底|所以我的建议是|总结一下)/g }
  ];

  const PRECISE = {
    '很好': ['清晰', '有效', '扎实'],
    '很多': ['数量可观', '高频出现', '覆盖广泛'],
    '很大': ['显著', '关键', '影响广'],
    '不好': ['低效', '不清晰', '有风险'],
    '觉得': ['认为', '判断', '观察到'],
    '做': ['推进', '落实', '完成'],
    '说': ['说明', '阐述', '强调'],
    '东西': ['内容', '信息', '方案'],
    '问题': ['阻碍', '偏差', '风险']
  };

  function cleanInput(text) {
    return String(text || '').replace(/\s+/g, ' ').trim();
  }

  function countChineseLike(text) {
    return (cleanInput(text).match(/[\u3400-\u9fffA-Za-z0-9]/g) || []).length;
  }

  function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function collectTerms(text, terms) {
    const hits = [];
    let remaining = text;
    terms.slice().sort((a, b) => b.length - a.length).forEach((term) => {
      const pattern = new RegExp(escapeRegExp(term), 'g');
      const matches = remaining.match(pattern) || [];
      if (matches.length) {
        hits.push({ term, count: matches.length });
        remaining = remaining.replace(pattern, ' '.repeat(term.length));
      }
    });
    return hits.sort((a, b) => b.count - a.count || b.term.length - a.term.length);
  }

  function splitSentences(text) {
    return cleanInput(text).split(/(?<=[。！？!?；;])/).map((item) => item.trim()).filter(Boolean);
  }

  function detectRepetitions(text) {
    const input = cleanInput(text); const hits = [];
    const pattern = /([\u3400-\u9fffA-Za-z]{2,8})(?:[，,、\s]*\1)+/g;
    let match;
    while ((match = pattern.exec(input)) !== null) {
      const copies = match[0].split(new RegExp(`[，,、\\s]*${escapeRegExp(match[1])}`)).length;
      hits.push({ text: match[1], count: Math.max(2, copies), index: match.index, type: 'consecutive' });
      if (!match[0].length) pattern.lastIndex += 1;
    }
    return hits;
  }

  function detectSelfCorrections(text) {
    const markers = ['不对', '不是', '我的意思是', '准确地说', '应该说', '换句话说', '我是说', '更正一下', '重新说'];
    return collectTerms(cleanInput(text), markers).map((item) => ({ marker: item.term, count: item.count, type: 'correction' }));
  }

  function detectRedundancies(text) {
    const rules = [
      { label: '同义叠加', pattern: /(目前现阶段|基本上大概|其实本质上|总的来说总体上|然后接着)/g },
      { label: '空泛套语', pattern: /(从某种(?:意义|程度)上来说|相对来说的话|我个人其实认为|比较.+的一个)/g },
      { label: '指代过多', pattern: /((?:这个|那个)(?:事情|问题|东西))(?:[^。！？]{0,18}\1)+/g }
    ];
    const hits = [];
    rules.forEach((rule) => { let match; rule.pattern.lastIndex = 0; while ((match = rule.pattern.exec(text)) !== null) hits.push({ text: match[0], label: rule.label, index: match.index }); });
    return hits;
  }

  function detectStructure(text) {
    const nodes = [];
    STRUCTURE_RULES.forEach((rule) => {
      rule.pattern.lastIndex = 0;
      let match;
      while ((match = rule.pattern.exec(text)) !== null) {
        nodes.push({ key: rule.key, label: rule.label, value: match[0], index: match.index, level: rule.level });
        if (match[0].length === 0) rule.pattern.lastIndex += 1;
      }
    });
    nodes.sort((a, b) => a.index - b.index);

    const numbered = nodes.filter((node) => /^point/.test(node.key));
    const levels = numbered.map((node) => node.level);
    const issues = [];
    if (levels.includes(2) && !levels.includes(1)) issues.push('出现了第二点，但没有识别到第一点。');
    if (levels.includes(3) && !levels.includes(2)) issues.push('出现了第三点，但没有识别到第二点。');
    for (let i = 1; i < levels.length; i += 1) {
      if (levels[i] < levels[i - 1]) {
        issues.push('序号顺序有回跳，建议检查观点排列。');
        break;
      }
    }
    const chars = countChineseLike(text);
    if (chars > 100 && !nodes.some((node) => node.key === 'conclusion')) issues.push('内容较长，但还没有明确的结论句。');
    if (chars > 150 && numbered.length === 0) issues.push('内容较长，可以用“第一点、第二点”显式分层。');
    if (chars > 180 && !nodes.some((node) => node.key === 'example')) issues.push('观点较多，但缺少例子或证据标记。');
    if (chars > 120 && !nodes.some((node) => node.key === 'closing')) issues.push('还没有识别到总结或行动建议。');

    let score = 28;
    if (nodes.some((node) => node.key === 'conclusion')) score += 16;
    score += Math.min(new Set(levels).size * 9, 27);
    if (nodes.some((node) => node.key === 'example')) score += 16;
    if (nodes.some((node) => node.key === 'closing')) score += 13;
    score -= issues.length * 6;
    return { nodes, issues, score: Math.max(20, Math.min(100, score)) };
  }

  function createFaithfulCleanup(text) {
    let output = cleanInput(text);
    const removable = ['嗯', '啊', '呃', '额', '那个', '就是说', '怎么说呢'];
    removable.forEach((term) => {
      output = output.replace(new RegExp(escapeRegExp(term), 'g'), '');
    });
    output = output
      .replace(/就是(?=(我觉得|我感觉|这个|信息|我们|可能|先|有点))/g, '')
      .replace(/(然后[，,、\s]*){2,}/g, '然后，')
      .replace(/[，,]{2,}/g, '，')
      .replace(/\s*([，。！？；])\s*/g, '$1')
      .replace(/^([，。；\s])+|([，；\s])+$/g, '')
      .trim();
    if (output && !/[。！？!?]$/.test(output)) output += '。';
    return output;
  }

  function analyze(text) {
    const input = cleanInput(text);
    const charCount = countChineseLike(input);
    const sentences = splitSentences(input);
    const groups = {};
    Object.keys(GROUPS).forEach((key) => { groups[key] = collectTerms(input, GROUPS[key]); });
    const fillerCount = groups.fillers.reduce((sum, item) => sum + item.count, 0);
    const hedgeCount = groups.hedges.reduce((sum, item) => sum + item.count, 0);
    const connectorCount = groups.connectors.reduce((sum, item) => sum + item.count, 0);
    const habitCount = groups.habits.reduce((sum, item) => sum + item.count, 0);
    const repetitions = detectRepetitions(input); const selfCorrections = detectSelfCorrections(input); const redundancies = detectRedundancies(input);
    const repetitionPenalty = repetitions.reduce((sum, item) => sum + Math.max(1, item.count - 1), 0);
    const correctionCount = selfCorrections.reduce((sum, item) => sum + item.count, 0);
    const density = charCount ? Math.max(0, Math.round((1 - (fillerCount + hedgeCount + repetitionPenalty * 2 + correctionCount + redundancies.length * 2) / charCount) * 100)) : 0;
    const structure = detectStructure(input);
    const precise = collectTerms(input, Object.keys(PRECISE)).map((item) => ({ ...item, alternatives: PRECISE[item.term] }));
    const repetitionRate = charCount ? Math.round((fillerCount + habitCount) / charCount * 1000) / 10 : 0;
    let fluencyScore = Math.round(density - Math.min(fillerCount * 2.2, 24) - Math.min(hedgeCount * 1.5, 12) - Math.min(repetitionPenalty * 3, 15) - Math.min(correctionCount * 2, 10) - Math.min(redundancies.length * 3, 12) + Math.min(connectorCount, 8));
    fluencyScore = Math.max(25, Math.min(100, fluencyScore));

    const priority = [];
    if (fillerCount) priority.push(`先减少“${groups.fillers.slice(0, 2).map((item) => item.term).join('、')}”，用短暂停顿替代。`);
    if (!priority.length && repetitions.length) priority.push(`“${repetitions[0].text}”出现连续重复，停一下再完整说下一句。`);
    if (!priority.length && redundancies.length) priority.push(`删去“${redundancies[0].text}”中的同义叠加，只保留一个准确说法。`);
    if (structure.issues.length) priority.push(structure.issues[0]);
    if (!priority.length) priority.push('结构和口头习惯较稳定，下一步可以增加具体例子。');

    return {
      input,
      charCount,
      sentenceCount: sentences.length,
      groups,
      counts: { fillers: fillerCount, hedges: hedgeCount, connectors: connectorCount, habits: habitCount, repetitions: repetitionPenalty, selfCorrections: correctionCount, redundancies: redundancies.length },
      density,
      repetitionRate,
      fluencyScore,
      structure,
      cleanliness: { score: fluencyScore, informationDensity: density, repetitions, selfCorrections, redundancies, issueCount: repetitionPenalty + correctionCount + redundancies.length },
      precise,
      priority,
      cleanup: createFaithfulCleanup(input)
    };
  }

  function significantChars(text) {
    return new Set((cleanInput(text).match(/[\u3400-\u9fffA-Za-z0-9]/g) || []).filter((char) => !'的是了和在与把被这那就都而及也'.includes(char)));
  }

  function keywordCoverage(reference, spoken, keywords) {
    const target = Array.isArray(keywords) && keywords.length ? keywords : Array.from(significantChars(reference)).slice(0, 12);
    const matched = target.filter((word) => cleanInput(spoken).includes(word));
    return { target, matched, missing: target.filter((word) => !matched.includes(word)), score: target.length ? Math.round(matched.length / target.length * 100) : 0 };
  }

  function readingComparison(reference, spoken) {
    const refChars = significantChars(reference);
    const spokenChars = significantChars(spoken);
    const hit = Array.from(refChars).filter((char) => spokenChars.has(char)).length;
    const coverage = refChars.size ? Math.round(hit / refChars.size * 100) : 0;
    const lengthRatio = countChineseLike(reference) ? countChineseLike(spoken) / countChineseLike(reference) : 0;
    const suggestions = [];
    if (coverage < 70 || lengthRatio < 0.72) suggestions.push('存在较多缺漏或误识别，建议放慢速度并按标点分句。');
    if (lengthRatio > 1.18) suggestions.push('识别稿比范文长，可能出现重复朗读或额外口头词。');
    if (!/[，；。！？]/.test(spoken) && countChineseLike(spoken) > 60) suggestions.push('长段内容没有形成清晰分句，逗号处短停、句号处完整停顿。');
    if (!suggestions.length) suggestions.push('整体跟读完整。下一轮重点练习逗号短停、句号收稳。');
    return { coverage, lengthRatio: Math.round(lengthRatio * 100), suggestions };
  }

  return { GROUPS, PRECISE, analyze, detectStructure, detectRepetitions, detectSelfCorrections, detectRedundancies, createFaithfulCleanup, keywordCoverage, readingComparison, countChineseLike };
});
