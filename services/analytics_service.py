"""Read-only, content-free aggregates. Server records are authoritative; client events are auxiliary."""
import json
import math
from collections import Counter

from training_store import TrainingError


def summarize(store, owner, days):
    if type(days) is not int or not 1 <= days <= 90:
        raise TrainingError('invalid_window', '统计范围应为 1–90 天。')
    cutoff = store.clock() - days * 86400
    clause, params = (' AND owner=?', [owner]) if owner is not None else ('', [])
    with store.db() as db:
        runs = db.execute('SELECT id,owner FROM runs WHERE created>=?' + clause, [cutoff, *params]).fetchall()
        attempts = db.execute('SELECT a.* FROM attempts a JOIN runs r ON a.run_id=r.id WHERE r.created>=?' + (' AND r.owner=?' if owner is not None else ''), [cutoff, *params]).fetchall()
        events = db.execute('SELECT name,emitter,payload FROM events WHERE received>=?' + clause, [cutoff, *params]).fetchall()
    first, second, invalid, provisional = set(), set(), 0, 0
    modes = Counter()
    totals, latencies, tokens = [], [], []
    for attempt in attempts:
        if not attempt['result']:
            continue
        result = json.loads(attempt['result'])
        scoring, meta = result.get('scoring', {}), result.get('assessment', {})
        modes[attempt['mode']] += 1
        if attempt['mode'] != 'guided':
            (first if attempt['round'] == 0 else second).add(attempt['run_id'])
        invalid += bool(scoring.get('invalid'))
        provisional += bool(scoring.get('provisional'))
        if attempt['mode'] == 'independent' and not scoring.get('invalid') and not scoring.get('provisional'):
            baseline = result.get('baselineScoring', {}).get('total')
            if type(baseline) in (int, float):
                totals.append(baseline)
        latency = meta.get('analysisLatencyMs')
        if type(latency) in (int, float) and latency >= 0:
            latencies.append(latency)
        token = meta.get('model', {}).get('usage', {}).get('total_tokens')
        if type(token) is int and token >= 0:
            tokens.append(token)
    latency_sorted = sorted(latencies)
    def percentile(p):
        return latency_sorted[max(0, math.ceil(p * len(latency_sorted)) - 1)] if latency_sorted else None
    event_counts, failures = Counter(), Counter()
    for event in events:
        event_counts[event['name']] += 1
        if event['name'] == 'assessment_failed' and event['emitter'] == 'server':
            code = json.loads(event['payload']).get('errorCode', 'unknown')
            failures[code] += 1
    started, complete = len(runs), len(first & second)
    return {
        'schemaVersion': 1, 'scope': 'personal' if owner is not None else 'operator', 'days': days,
        'cohort': '统计窗口内创建的训练；包含这些训练后续完成的作答。',
        'training': {'started': started, 'firstScored': len(first), 'secondScored': len(second), 'completed': complete,
                     'completionRate': round(100 * complete / started, 1) if started else None},
        'assessment': {'saved': sum(modes.values()), 'invalid': invalid, 'provisional': provisional,
                       'independent': modes['independent'], 'guided': modes['guided'], 'demo': modes['demo'],
                       'baselineAverage': round(sum(totals) / len(totals), 1) if totals else None, 'baselineSamples': len(totals)},
        'service': {'p50Ms': percentile(.5), 'p95Ms': percentile(.95), 'latencySamples': len(latencies),
                    'reportedTokens': sum(tokens) if tokens else None, 'usageSamples': len(tokens),
                    'failedRequests': sum(failures.values()), 'errors': dict(failures)},
        'events': dict(event_counts),
        'activeLearners': len({run['owner'] for run in runs}),
        'boundary': '完成率不代表学习达标；基准均值不是成长趋势。Token 仅含成功留存且返回用量的调用，不等于账单。客户端事件为自愿采集。',
    }
