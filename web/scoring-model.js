(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ExpressionScoring = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const COMPONENTS = {
    first: {
      oralControl: '口头禅、语气词控制',
      pauseRhythm: '停顿与节奏',
      connectorLogic: '衔接词、转折使用',
      paceFluency: '语速与流畅度',
      centralAccuracy: '中心意思准确度',
      keyCoverage: '关键内容覆盖',
      semanticConciseness: '语义转换与简洁度'
    },
    second: {
      centralAccuracy: '中心思想',
      keyCoverage: '关键信息',
      compressionTime: '压缩总结与时间',
      pausePace: '停顿与语速',
      connectorLogic: '衔接与逻辑',
      oralControl: '口头语控制',
      informationLogic: '信息关系'
    }
  };

  const DEFAULT_WEIGHTS = {
    first: {
      oralControl: 25,
      pauseRhythm: 20,
      connectorLogic: 15,
      paceFluency: 10,
      centralAccuracy: 5,
      keyCoverage: 20,
      semanticConciseness: 5
    },
    second: {
      centralAccuracy: 35,
      keyCoverage: 15,
      compressionTime: 5,
      pausePace: 10,
      connectorLogic: 10,
      oralControl: 15,
      informationLogic: 10
    }
  };

  const FIRST_PRESETS = {
    balanced: { label: '基础测评', weights: DEFAULT_WEIGHTS.first },
    oral: { label: '减少口头语', weights: { oralControl: 35, pauseRhythm: 15, connectorLogic: 15, paceFluency: 10, centralAccuracy: 5, keyCoverage: 15, semanticConciseness: 5 } },
    pause: { label: '停顿节奏', weights: { oralControl: 20, pauseRhythm: 30, connectorLogic: 15, paceFluency: 10, centralAccuracy: 5, keyCoverage: 15, semanticConciseness: 5 } },
    logic: { label: '逻辑衔接', weights: { oralControl: 20, pauseRhythm: 15, connectorLogic: 30, paceFluency: 10, centralAccuracy: 5, keyCoverage: 15, semanticConciseness: 5 } },
    concise: { label: '精简表达', weights: { oralControl: 20, pauseRhythm: 15, connectorLogic: 15, paceFluency: 10, centralAccuracy: 5, keyCoverage: 15, semanticConciseness: 20 } }
  };

  function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
  function cloneWeights(weights) { return Object.assign({}, weights); }
  function totalWeight(weights) { return Object.values(weights || {}).reduce((sum, value) => sum + Number(value || 0), 0); }
  function validWeights(weights, round) {
    const expected = Object.keys(COMPONENTS[round]);
    return expected.every((key) => Number.isFinite(Number(weights?.[key])) && Number(weights[key]) >= 0) && totalWeight(weights) === 100;
  }

  function oralControlScore(result) {
    const chars = Math.max(result.oral.charCount, 1);
    const fillerRate = result.oral.counts.fillers / chars * 100;
    const hedgeRate = result.oral.counts.hedges / chars * 100;
    return Math.round(clamp(100 - Math.max(0, fillerRate - 1) * 9 - hedgeRate * 3, 25, 100));
  }

  function pauseRhythmScore(result) {
    if (!result.pauses?.length) return null;
    const long = result.pauses.filter((value) => value >= 3).length;
    const veryLong = result.pauses.filter((value) => value >= 5).length;
    const averagePenalty = result.averagePause > 2.2 ? (result.averagePause - 2.2) * 10 : 0;
    return Math.round(clamp(100 - long * 7 - veryLong * 10 - averagePenalty, 25, 100));
  }

  function paceScore(result) {
    if (!result.pace) return null;
    if (result.pace >= 150 && result.pace <= 260) return 100;
    if (result.pace < 150) return Math.round(clamp(100 - (150 - result.pace) * .45, 30, 100));
    return Math.round(clamp(100 - (result.pace - 260) * .35, 30, 100));
  }

  function connectorLogicScore(result) {
    const chars = Math.max(result.oral.charCount, 1);
    const count = result.oral.counts.connectors;
    let score = result.oral.structure.score;
    if (chars >= 60 && count === 0) score -= 12;
    if (count / chars * 100 > 8) score -= 10;
    score -= result.oral.structure.issues.length * 5;
    return Math.round(clamp(score, 25, 100));
  }

  function centralAccuracyScore(result) {
    return Math.round(clamp(35 + result.content.score * .65, 20, 100));
  }

  function semanticConcisenessScore(result, exercise) {
    const sourceLength = Math.max((String(exercise?.text || '').match(/[\u3400-\u9fffA-Za-z0-9]/g) || []).length, 1);
    const ratio = result.oral.charCount / sourceLength;
    let score = 100;
    if (ratio < .22) score -= (.22 - ratio) * 180;
    if (ratio > .8) score -= (ratio - .8) * 75;
    score -= Math.min(result.oral.counts.fillers * 2, 14);
    return Math.round(clamp(score, 25, 100));
  }

  function timeScore(result) {
    if (!result.elapsed) return null;
    if (result.elapsed >= 15 && result.elapsed <= 60) return 100;
    if (result.elapsed < 15) return Math.round(clamp(100 - (15 - result.elapsed) * 3, 40, 100));
    return Math.round(clamp(100 - (result.elapsed - 60) * .7, 35, 100));
  }

  function averageAvailable(values) {
    const available = values.filter((value) => Number.isFinite(value));
    return available.length ? Math.round(available.reduce((sum, value) => sum + value, 0) / available.length) : null;
  }

  function componentScores(round, result, exercise) {
    const shared = {
      oralControl: oralControlScore(result),
      connectorLogic: connectorLogicScore(result),
      centralAccuracy: centralAccuracyScore(result),
      keyCoverage: result.content.score
    };
    const pause = pauseRhythmScore(result);
    const pace = paceScore(result);
    const concise = semanticConcisenessScore(result, exercise);
    if (round === 'first') {
      return Object.assign(shared, {
        pauseRhythm: pause,
        paceFluency: averageAvailable([pace, result.oral.fluencyScore]),
        semanticConciseness: concise
      });
    }
    return Object.assign(shared, {
      compressionTime: averageAvailable([concise, timeScore(result)]),
      pausePace: averageAvailable([pause, pace]),
      informationLogic: result.oral.structure.score
    });
  }

  function assessValidity(round, result) {
    const minimumSeconds = round === 'first' ? 15 : 10;
    const minimumChars = round === 'first' ? 24 : 18;
    const matchedConcepts = Number(result.content?.matched?.length || 0);
    const text = String(result.transcript || '').replace(/\s+/g, '');
    const hasViewpoint = /(?:是|要|应|需|主要|核心|说明|因为|所以|关键|意味着|不能|可以|通过|导致|帮助|结论|观点)/.test(text);
    const reasons = [];
    if (!Number.isFinite(result.elapsed) || result.elapsed < minimumSeconds) reasons.push(`作答少于${minimumSeconds}秒`);
    if (Number(result.pace || 0) > 360) reasons.push('作答速度超过合理口语范围');
    if (Number(result.oral?.charCount || 0) < minimumChars) reasons.push(`有效内容少于${minimumChars}字`);
    if (matchedConcepts === 0) reasons.push('四个核心知识点均未覆盖');
    if (!hasViewpoint) reasons.push('没有形成可判断的完整观点');
    return {
      valid: reasons.length === 0,
      reasons,
      minimumSeconds,
      minimumChars,
      matchedConcepts,
      hasViewpoint
    };
  }

  function calculate(round, result, exercise, weights) {
    const chosen = validWeights(weights, round) ? cloneWeights(weights) : cloneWeights(DEFAULT_WEIGHTS[round]);
    const gate = assessValidity(round, result);
    if (!gate.valid) {
      return {
        total: 0,
        components: Object.fromEntries(Object.keys(chosen).map((key) => [key, 0])),
        weights: chosen,
        missing: [],
        provisional: false,
        invalid: true,
        gate
      };
    }
    const scores = componentScores(round, result, exercise);
    let earned = 0; let availableWeight = 0;
    Object.keys(chosen).forEach((key) => {
      if (Number.isFinite(scores[key])) {
        earned += scores[key] * chosen[key];
        availableWeight += chosen[key];
      }
    });
    return {
      total: availableWeight ? Math.round(earned / availableWeight) : null,
      components: scores,
      weights: chosen,
      missing: Object.keys(chosen).filter((key) => !Number.isFinite(scores[key])),
      provisional: availableWeight < 100 || Boolean(result.content?.provisional || result.asr?.needsConfirmation),
      invalid: false,
      gate
    };
  }

  function recommendFirst(result, exercise) {
    const scores = componentScores('first', result, exercise);
    const candidates = ['oralControl', 'pauseRhythm', 'connectorLogic', 'semanticConciseness']
      .filter((key) => Number.isFinite(scores[key]))
      .sort((a, b) => scores[a] - scores[b]);
    const weakest = candidates[0] || 'oralControl';
    const presetKey = ({ oralControl: 'oral', pauseRhythm: 'pause', connectorLogic: 'logic', semanticConciseness: 'concise' })[weakest];
    return { presetKey, label: FIRST_PRESETS[presetKey].label, weakest, score: scores[weakest], weights: cloneWeights(FIRST_PRESETS[presetKey].weights) };
  }

  return { COMPONENTS, DEFAULT_WEIGHTS, FIRST_PRESETS, cloneWeights, totalWeight, validWeights, assessValidity, componentScores, calculate, recommendFirst };
});
