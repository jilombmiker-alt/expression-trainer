// One-shot, bounded server-side execution of the shared scoring rules. No keys enter this process.
const fs = require('node:fs');
const Analyzer = require('../web/analyzer.js');
const Semantic = require('../web/semantic-evaluator.js');
const Scoring = require('../web/scoring-model.js');
const data = JSON.parse(fs.readFileSync(0, 'utf8'));
const oral = Analyzer.analyze(data.transcript);
const content = Semantic.evaluate(data.exercise, data.transcript, data.modelAssessment);
const pauses = data.pauses || [];
const result = { oral, content, transcript: data.transcript, elapsed: data.elapsed,
  pace: data.elapsed ? Math.round(oral.charCount / data.elapsed * 60) : 0,
  pauses, averagePause: pauses.length ? pauses.reduce((a, b) => a + b, 0) / pauses.length : 0,
  longestPause: pauses.length ? Math.max(...pauses) : 0, asr: data.asr || null };
result.scoring = Scoring.calculate(data.round, result, data.exercise, data.weights);
result.baselineScoring = Scoring.calculate(data.round, result, data.exercise, Scoring.DEFAULT_WEIGHTS[data.round]);
// Browser timing is useful feedback, never verified oral ability evidence.
if (!data.verifiedTiming) {
  result.scoring.provisional = true; result.baselineScoring.provisional = true;
}
process.stdout.write(JSON.stringify(result));
