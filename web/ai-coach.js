(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ExpressionAICoach = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function issue(dimension, title, evidence, impact, question) { return { dimension, title, evidence, impact, question }; }
  function diagnose(result, exercise, roundIndex) {
    const issues = [];
    if (result.scoring.invalid) {
      issues.push(issue('有效作答', '先把观点说完整', result.scoring.gate.reasons.join('；'), '当前内容无法形成可靠评估，因此本轮记 0 分。', '如果只用一句话，你认为原文最想说明什么？'));
    } else {
      const missing = result.content.missing || [];
      if (missing.length) issues.push(issue('内容理解', `遗漏 ${missing.length} 个信息点`, `未明确提到：${missing.slice(0, 3).map((item) => item.label).join('、')}`, '听者可能得到结论，却不知道结论成立的依据。', '你能补充一个“为什么”或“怎么做”的原文信息吗？'));
      const connector = result.scoring.components.connectorLogic;
      if (Number.isFinite(connector) && connector < 75) issues.push(issue('结构与逻辑', '句子之间的关系不够清楚', result.oral.structure.issues[0] || `识别到 ${result.oral.counts.connectors} 个衔接词`, '并列、因果和结论混在一起，会增加理解成本。', '能否用“结论—原因—行动”三步再说一次？'));
      if (result.oral.counts.fillers) issues.push(issue('口语控制', '填充词打断了信息推进', `检测到 ${result.oral.counts.fillers} 次：${result.oral.groups.fillers.slice(0, 3).map((item) => item.term).join('、')}`, '它们会占用听者注意力，并让观点显得不确定。', '下一次想说填充词时，能否改成一次短暂停顿？'));
      if (result.oral.counts.repetitions) issues.push(issue('语言洁净度', '出现无效重复', `连续重复 ${result.oral.counts.repetitions} 次：${result.oral.cleanliness.repetitions.slice(0, 2).map((item) => item.text).join('、')}`, '同一信息重复启动，会降低表达密度。', '能否停半秒，只保留后面那次完整表达？'));
      if (result.oral.counts.selfCorrections || result.oral.counts.redundancies) issues.push(issue('语义转换', '自我修正或冗余占用了表达空间', `自我修正 ${result.oral.counts.selfCorrections} 次，冗余表达 ${result.oral.counts.redundancies} 处`, '听者需要在多个版本中判断你真正想表达的意思。', '开口前先确定一句主干，再补原因或行动，可以吗？'));
      if (result.pauses?.length && (result.longestPause >= 3 || result.averagePause > 2.2)) issues.push(issue('停顿与节奏', '长停顿集中在句子中间', `平均 ${result.averagePause.toFixed(1)} 秒，最长 ${result.longestPause.toFixed(1)} 秒`, '语义组被切断，听者需要重新拼接句意。', '先想好下一句关键词，再从完整语义组开始，可以吗？'));
      const conciseKey = roundIndex === 0 ? 'semanticConciseness' : 'compressionTime';
      if (Number.isFinite(result.scoring.components[conciseKey]) && result.scoring.components[conciseKey] < 70) issues.push(issue('压缩与转述', '信息还可以更紧凑', `当前有效字数 ${result.oral.charCount}，该项 ${result.scoring.components[conciseKey]} 分`, '重复解释会冲淡中心信息。', '如果只保留“一句中心 + 三个信息点”，你会删掉哪一句？'));
    }
    if (!issues.length) issues.push(issue('迁移表达', '内容已经比较完整', '主要知识点和表达结构均达到当前目标', '下一步需要检验能否换一种对象和场景继续讲清楚。', '能否把它解释给一个完全不了解这件事的人？'));
    return {
      mode: 'guided-retry', provider: 'local-rules', confidence: 'limited', issues: issues.slice(0, 3),
      boundary: `${result.pauses?.length ? '本次包含带时间戳的麦克风停顿记录' : '本次未获得麦克风停顿数据，不判断停顿节奏'}；${result.content?.method === 'model-hybrid' ? '语义由模型与概念证据共同判断。' : '语义为知识点与关系结构的本地混合暂定判断。'}`
    };
  }
  function compare(before, after) {
    const beforeMatched = before.content.matched?.length || 0; const afterMatched = after.content.matched?.length || 0;
    return {
      scoreDelta: Number(after.scoring.total || 0) - Number(before.scoring.total || 0),
      conceptDelta: afterMatched - beforeMatched,
      fillerDelta: Number(before.oral.counts.fillers || 0) - Number(after.oral.counts.fillers || 0),
      repetitionDelta: Number(before.oral.counts.repetitions || 0) - Number(after.oral.counts.repetitions || 0),
      correctionDelta: Number(before.oral.counts.selfCorrections || 0) - Number(after.oral.counts.selfCorrections || 0),
      redundancyDelta: Number(before.oral.counts.redundancies || 0) - Number(after.oral.counts.redundancies || 0),
      densityDelta: Number(after.oral.density || 0) - Number(before.oral.density || 0),
      relationDelta: Number(after.content.relationScore || 0) - Number(before.content.relationScore || 0),
      better: Number(after.scoring.total || 0) > Number(before.scoring.total || 0)
    };
  }
  function reference(exercise) {
    return `这段内容主要说明：${exercise.central}。可以按三步表达：第一，${exercise.concepts[0].label}；第二，${exercise.concepts[1].label}；最后结合${exercise.concepts.slice(2).map((item) => item.label).join('与')}，给出结论或行动。`;
  }
  return { diagnose, compare, reference };
});
