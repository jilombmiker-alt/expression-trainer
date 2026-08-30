(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ExpressionProgress = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const STORAGE_KEY = 'expression.progress.v1';
  const LEVELS = [
    { id: 1, min: 0, max: 39, name: '建立表达' },
    { id: 2, min: 40, max: 54, name: '完整转述' },
    { id: 3, min: 55, max: 64, name: '清楚表达' },
    { id: 4, min: 65, max: 74, name: '结构表达' },
    { id: 5, min: 75, max: 84, name: '准确表达' },
    { id: 6, min: 85, max: 92, name: '高效表达' },
    { id: 7, min: 93, max: 100, name: '灵活迁移' }
  ];
  const DIMENSIONS = {
    oralControl: '口语控制', pauseFluency: '停顿与流畅度', structureLogic: '结构与逻辑',
    contentUnderstanding: '内容理解', informationCapture: '信息抓取', compressionRetell: '压缩与转述'
  };
  const PLAN_MODES = { consolidate: '巩固', improve: '提升', levelup: '冲级' };

  function clamp(value) { return Math.max(0, Math.min(100, Math.round(Number(value) || 0))); }
  function average(values) {
    const available = values.filter(Number.isFinite);
    return available.length ? clamp(available.reduce((sum, value) => sum + value, 0) / available.length) : null;
  }
  function levelFor(score) {
    const value = clamp(score);
    return LEVELS.find((level) => value >= level.min && value <= level.max) || LEVELS[0];
  }
  function nextLevel(score) {
    const level = levelFor(score);
    return LEVELS.find((item) => item.id === level.id + 1) || null;
  }
  function abilityIndex(firstTotal, secondTotal) {
    if (!Number.isFinite(firstTotal) || !Number.isFinite(secondTotal)) return null;
    return clamp(firstTotal * .5 + secondTotal * .5);
  }
  function dimensionScores(first, second) {
    if (!first?.scoring || !second?.scoring || first.scoring.invalid || second.scoring.invalid) return null;
    const a = first.scoring.components; const b = second.scoring.components;
    return {
      oralControl: average([a.oralControl, b.oralControl]),
      pauseFluency: average([a.pauseRhythm, a.paceFluency, b.pausePace]),
      structureLogic: average([a.connectorLogic, b.connectorLogic, b.informationLogic]),
      contentUnderstanding: average([a.centralAccuracy, b.centralAccuracy]),
      informationCapture: average([a.keyCoverage, b.keyCoverage]),
      compressionRetell: average([a.semanticConciseness, b.compressionTime])
    };
  }
  function emptyStore() { return { version: 1, records: [], plans: [], activePlanId: null, exams: [] }; }
  function normalizeStore(value) {
    const base = emptyStore(); const data = value && typeof value === 'object' ? value : {};
    base.records = Array.isArray(data.records) ? data.records.slice(-100) : [];
    base.plans = Array.isArray(data.plans) ? data.plans : [];
    base.activePlanId = data.activePlanId || null;
    base.exams = Array.isArray(data.exams) ? data.exams.slice(-50) : [];
    return base;
  }
  function load(storage) {
    try { return normalizeStore(JSON.parse((storage || localStorage).getItem(STORAGE_KEY) || 'null')); }
    catch (_) { return emptyStore(); }
  }
  function save(data, storage) {
    const normalized = normalizeStore(data);
    try { (storage || localStorage).setItem(STORAGE_KEY, JSON.stringify(normalized)); } catch (_) {}
    return normalized;
  }
  function recordSession(data, record) {
    const next = normalizeStore(data);
    next.records.push(Object.assign({ id: `session-${Date.now()}`, at: new Date().toISOString(), valid: false, score: 0 }, record));
    next.records = next.records.slice(-100);
    return next;
  }
  function profile(data) {
    const records = normalizeStore(data).records;
    const valid = records.filter((record) => record.valid && Number.isFinite(record.score));
    const recent = valid.slice(-5); const scores = recent.map((record) => clamp(record.score));
    const current = scores.length ? average(scores) : 0;
    const historicalHigh = valid.length ? Math.max(...valid.map((record) => clamp(record.score))) : 0;
    const earned = levelFor(historicalHigh);
    const next = nextLevel(historicalHigh);
    const dimensions = {};
    Object.keys(DIMENSIONS).forEach((key) => {
      dimensions[key] = average(recent.map((record) => record.dimensions?.[key]).filter(Number.isFinite));
    });
    let streak = 0;
    for (let index = records.length - 1; index >= 0 && records[index].valid; index -= 1) streak += 1;
    const firstHalf = scores.slice(0, Math.max(1, Math.floor(scores.length / 2)));
    const secondHalf = scores.slice(Math.max(1, Math.floor(scores.length / 2)));
    const change = scores.length > 1 ? clamp(average(secondHalf)) - clamp(average(firstHalf)) : 0;
    return { total: records.length, validCount: valid.length, current, historicalHigh, earned, next, distance: next ? Math.max(0, next.min - current) : 0, dimensions, recent: scores, streak, change };
  }
  function recommendPlan(data) {
    const view = profile(data);
    const ranked = Object.keys(DIMENSIONS).map((key) => ({ key, value: Number.isFinite(view.dimensions[key]) ? view.dimensions[key] : 50 })).sort((a, b) => a.value - b.value);
    return {
      name: `${DIMENSIONS[ranked[0].key]}提升计划`, primary: ranked[0].key, secondary: ranked[1].key,
      maintenance: ranked[2].key, ratios: { primary: 60, secondary: 25, maintenance: 15 }, mode: 'improve', source: 'mixed',
      baseline: view.current, target: Math.min(100, view.current + 10)
    };
  }
  function validPlan(plan) {
    const ratios = plan?.ratios || {};
    return [ratios.primary, ratios.secondary, ratios.maintenance].every((value) => Number.isFinite(Number(value)) && Number(value) >= 0)
      && Number(ratios.primary) + Number(ratios.secondary) + Number(ratios.maintenance) === 100
      && Boolean(DIMENSIONS[plan.primary] && DIMENSIONS[plan.secondary] && DIMENSIONS[plan.maintenance]);
  }
  function upsertPlan(data, plan) {
    if (!validPlan(plan)) throw new Error('训练比例必须合计 100%');
    const next = normalizeStore(data); const item = Object.assign({}, plan);
    item.id = item.id || `plan-${Date.now()}`; item.updatedAt = new Date().toISOString();
    const index = next.plans.findIndex((value) => value.id === item.id);
    if (index >= 0) next.plans[index] = item; else next.plans.push(item);
    next.activePlanId = item.id; return next;
  }
  function activePlan(data) {
    const normalized = normalizeStore(data);
    return normalized.plans.find((plan) => plan.id === normalized.activePlanId) || null;
  }
  function readiness(data) {
    const view = profile(data); const active = activePlan(data);
    if (!active) return { score: 0, label: '先创建专项计划', ready: false };
    const primary = view.dimensions[active.primary]; const target = Number(active.target || 0);
    const evidence = Math.min(100, view.streak * 20);
    const ability = Number.isFinite(primary) ? primary : 0;
    const score = clamp(ability * .7 + evidence * .3);
    return { score, label: view.streak < 3 ? `还需 ${3 - view.streak} 次有效练习形成稳定证据` : ability >= target ? '已具备考试条件' : `专项能力距离目标 ${Math.max(0, target - ability)} 分`, ready: view.streak >= 3 && ability >= target };
  }
  return { STORAGE_KEY, LEVELS, DIMENSIONS, PLAN_MODES, levelFor, nextLevel, abilityIndex, dimensionScores, emptyStore, normalizeStore, load, save, recordSession, profile, recommendPlan, validPlan, upsertPlan, activePlan, readiness };
});
