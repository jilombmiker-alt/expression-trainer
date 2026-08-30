(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ExpressionSemantic = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const RELATIONS = [
    { key: 'cause', label: '因果', pattern: /(因为|由于|原因|导致|所以|因此|从而|结果)/ },
    { key: 'contrast', label: '转折', pattern: /(但是|不过|然而|却|而不是|相反)/ },
    { key: 'condition', label: '条件', pattern: /(如果|只有|只要|除非|前提|条件)/ },
    { key: 'sequence', label: '顺序', pattern: /(首先|其次|然后|随后|最后|第一|第二|第三)/ },
    { key: 'action', label: '行动', pattern: /(需要|应该|必须|行动|负责人|完成|落实|建议)/ },
    { key: 'conclusion', label: '结论', pattern: /(总之|综上|核心是|关键是|结论|主要说明|意味着)/ }
  ];

  function normalize(text) { return String(text || '').toLowerCase().replace(/[\s，。！？；、,.!?;:'"“”‘’（）()《》]/g, ''); }
  function chars(text) { return new Set(Array.from(normalize(text)).filter((char) => /[\u3400-\u9fffA-Za-z0-9]/.test(char))); }
  function overlap(a, b) {
    const left = chars(a); const right = chars(b);
    if (!left.size || !right.size) return 0;
    const hit = Array.from(left).filter((item) => right.has(item)).length;
    return hit / Math.min(left.size, right.size);
  }
  function extractRelations(text) {
    return RELATIONS.filter((item) => item.pattern.test(String(text || ''))).map((item) => ({ key: item.key, label: item.label }));
  }
  function validModelAssessment(value, exercise) {
    if (!value || !Array.isArray(value.concepts)) return false;
    const labels = new Set((exercise?.concepts || []).map((item) => item.label));
    return value.concepts.every((item) => labels.has(item.label) && ['matched', 'missing', 'conflict'].includes(item.status) && typeof item.evidence === 'string');
  }
  function evaluate(exercise, transcript, modelAssessment) {
    const value = normalize(transcript);
    const modelValid = validModelAssessment(modelAssessment, exercise);
    const details = (exercise.concepts || []).map((concept) => {
      const hitTerms = Array.from(new Set(concept.terms || [])).filter((term) => value.includes(normalize(term)));
      const model = modelValid ? modelAssessment.concepts.find((item) => item.label === concept.label) : null;
      const fuzzyTerm = hitTerms.length ? null : [concept.label, ...(concept.terms || [])]
        .map((term) => ({ term, score: overlap(term, transcript) })).sort((a, b) => b.score - a.score)[0];
      if (model?.status === 'conflict') return { label: concept.label, hit: false, hitTerms: [], matchType: 'conflict', evidence: model.evidence, confidence: model.confidence || null };
      if (model?.status === 'matched') return { label: concept.label, hit: true, hitTerms: [], matchType: 'model', evidence: model.evidence, confidence: model.confidence || null };
      if (hitTerms.length) return { label: concept.label, hit: true, hitTerms, matchType: 'exact', evidence: hitTerms.join('、'), confidence: 1 };
      if (!modelValid && fuzzyTerm?.score >= .84 && normalize(fuzzyTerm.term).length >= 2) return { label: concept.label, hit: true, hitTerms: [fuzzyTerm.term], matchType: 'fuzzy', evidence: fuzzyTerm.term, confidence: Math.round(fuzzyTerm.score * 100) / 100 };
      return { label: concept.label, hit: false, hitTerms: [], matchType: 'missing', evidence: model?.evidence || '', confidence: model?.confidence || null };
    });
    const matched = details.filter((item) => item.hit);
    const missing = details.filter((item) => !item.hit);
    const sourceRelations = extractRelations(`${exercise.text || ''}${exercise.central || ''}`);
    const spokenRelations = extractRelations(transcript);
    const relationHits = sourceRelations.filter((item) => spokenRelations.some((spoken) => spoken.key === item.key));
    const conceptScore = details.length ? matched.length / details.length * 100 : 0;
    const relationScore = sourceRelations.length ? relationHits.length / sourceRelations.length * 100 : 100;
    return {
      details, matched, missing,
      score: Math.round(conceptScore * .8 + relationScore * .2),
      conceptScore: Math.round(conceptScore), relationScore: Math.round(relationScore),
      relations: { source: sourceRelations, spoken: spokenRelations, matched: relationHits },
      conflicts: details.filter((item) => item.matchType === 'conflict'),
      method: modelValid ? 'model-hybrid' : 'local-hybrid', provisional: !modelValid
    };
  }
  return { RELATIONS, normalize, overlap, extractRelations, validModelAssessment, evaluate };
});
