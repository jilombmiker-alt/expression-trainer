import json
import os
import tempfile
import unittest
import uuid
from pathlib import Path
from unittest.mock import patch

from analytics_service import summarize
from operator_access import OperatorAccess
from training_store import TrainingStore, TrainingError
from test_training_backend import EXERCISE, WEIGHTS
import test_training_backend as harness
import p0_service as app


class SummaryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.now = 2000000
        self.store = TrainingStore(Path(self.temp.name) / 'data.sqlite3', clock=lambda: self.now)

    def run_record(self, owner):
        return self.store.create_run(owner, {'rounds': [EXERCISE, EXERCISE], 'weights': WEIGHTS})['id']

    def result(self, owner, run_id, round_index, mode='independent', invalid=False, provisional=False, score=80, tokens=None):
        attempt_id = str(uuid.uuid4())
        self.store.start_attempt(owner, run_id, round_index, mode, attempt_id)
        # Persist through the same finish transaction as real assessments.
        result = {'scoring': {'total': score, 'invalid': invalid, 'provisional': provisional, 'components': []},
                  'baselineScoring': {'total': score},
                  'assessment': {'trainingId': run_id, 'attemptId': attempt_id, 'round': round_index, 'mode': mode,
                                 'scoringVersion': 1, 'fallbackCode': '', 'analysisLatencyMs': 100,
                                 'model': {'usage': {} if tokens is None else {'total_tokens': tokens}}},
                  'transcript': 'private content never in aggregates'}
        self.store.finish(owner, attempt_id, result)
        return attempt_id, result

    def test_empty_is_unknown_not_fake_zero_score(self):
        data = summarize(self.store, 'a', 7)
        self.assertEqual(data['training']['started'], 0)
        self.assertIsNone(data['training']['completionRate'])
        self.assertIsNone(data['assessment']['baselineAverage'])
        self.assertIsNone(data['service']['reportedTokens'])
        self.assertIsNone(data['service']['p95Ms'])

    def test_distinct_round_completion_owner_isolation_and_guided_exclusion(self):
        run = self.run_record('a')
        attempt, result = self.result('a', run, 0, tokens=0)
        self.store.finish('a', attempt, result)  # Idempotent duplicate must not count twice.
        self.result('a', run, 0, mode='guided', score=99)
        self.result('a', run, 1, score=60, tokens=10)
        self.run_record('b')
        data = summarize(self.store, 'a', 7)
        self.assertEqual(data['training'], {'started': 1, 'firstScored': 1, 'secondScored': 1, 'completed': 1, 'completionRate': 100})
        self.assertEqual(data['assessment']['baselineAverage'], 70)
        self.assertEqual(data['assessment']['saved'], 3)
        self.assertEqual(data['events']['assessment_finished'], 3)
        self.assertEqual(data['service']['reportedTokens'], 10)
        self.assertEqual(data['service']['usageSamples'], 2)
        self.assertEqual(summarize(self.store, None, 7)['training']['completionRate'], 50)
        self.assertEqual(summarize(self.store, 'b', 7)['assessment']['saved'], 0)
        self.assertNotIn('private content', json.dumps(data))
        self.assertNotIn('owner', data)

    def test_invalid_demo_provisional_not_in_baseline_and_time_window(self):
        run = self.run_record('a')
        self.result('a', run, 0, invalid=True, score=0)
        self.result('a', run, 0, mode='demo', score=100)
        self.result('a', run, 1, provisional=True, score=40)
        summary = summarize(self.store, 'a', 7)
        self.assertIsNone(summary['assessment']['baselineAverage'])
        self.assertEqual(summary['assessment']['invalid'], 1)
        self.assertEqual(summary['assessment']['demo'], 1)
        self.now += 8 * 86400
        self.assertEqual(summarize(self.store, 'a', 7)['training']['started'], 0)
        self.assertEqual(summarize(self.store, 'a', 30)['training']['started'], 1)
        for days in [0, 91, True, '7']:
            with self.assertRaises(TrainingError):
                summarize(self.store, 'a', days)

    def test_preferences_persist_and_are_isolated(self):
        self.assertFalse(self.store.privacy('a')['optionalAnalytics'])
        self.store.privacy('a', True)
        self.assertTrue(TrainingStore(self.store.path).privacy('a')['optionalAnalytics'])
        self.assertFalse(self.store.privacy('b')['optionalAnalytics'])
        self.assertFalse(self.store.privacy('a', False)['optionalAnalytics'])
        with self.assertRaises(TrainingError):
            self.store.privacy('a', 1)

    def test_failures_count_server_only(self):
        self.store.server_event('a', 'assessment_failed', {'errorCode': 'provider_timeout'})
        self.assertEqual(summarize(self.store, 'a', 7)['service']['errors'], {'provider_timeout': 1})


class OperatorTests(unittest.TestCase):
    def test_disabled_binding_expiry_and_logout(self):
        now = [0]
        access = OperatorAccess(clock=lambda: now[0])
        with patch.dict(os.environ, {'EXPRESSION_ADMIN_TOKEN': ''}):
            with self.assertRaises(TrainingError) as error:
                access.login('a', 'anything')
            self.assertEqual(error.exception.status, 503)
        with patch.dict(os.environ, {'EXPRESSION_ADMIN_TOKEN': 'x' * 40}):
            token = access.login('a', 'x' * 40)
            access.require('a', token)
            with self.assertRaises(TrainingError):
                access.require('b', token)
            access.logout(token)
            with self.assertRaises(TrainingError):
                access.require('a', token)
            token = access.login('a', 'x' * 40)
            now[0] = 3601
            with self.assertRaises(TrainingError):
                access.require('a', token)

    def test_brute_force_is_limited(self):
        access = OperatorAccess(clock=lambda: 0)
        with patch.dict(os.environ, {'EXPRESSION_ADMIN_TOKEN': 'x' * 40}):
            for _ in range(5):
                with self.assertRaises(TrainingError):
                    access.login('a', 'incorrect')
            with self.assertRaises(TrainingError) as error:
                access.login('a', 'x' * 40)
            self.assertEqual(error.exception.status, 429)


class AnalyticsHTTPTests(unittest.TestCase):
    # Reuse the HTTP harness, not the full inherited test suite.
    setUp = harness.HTTPTrainingTests.setUp
    call = harness.HTTPTrainingTests.call

    def test_summary_privacy_and_admin_contract(self):
        self.assertEqual(self.call('GET', '/api/analytics/summary')[0], 401)
        self.assertEqual(self.call('GET', '/api/analytics/summary?days=invalid', cookie=self.cookie)[0], 400)
        self.assertEqual(self.call('GET', '/api/analytics/summary?days=91', cookie=self.cookie)[0], 400)
        self.assertEqual(self.call('GET', '/api/analytics/summary', cookie=self.cookie)[1]['scope'], 'personal')
        event = {'id': str(uuid.uuid4()), 'name': 'step_viewed', 'data': {'step': 1}, 'occurredAt': 1000000}
        self.assertEqual(self.call('POST', '/api/events', {'events': [event]}, self.cookie)[0], 403)
        self.assertEqual(self.call('POST', '/api/privacy', {'optionalAnalytics': True}, self.cookie)[0], 200)
        self.assertEqual(self.call('POST', '/api/events', {'events': [event]}, self.cookie)[0], 200)
        self.assertFalse(self.call('GET', '/api/privacy', cookie=self.other)[1]['optionalAnalytics'])
        self.assertEqual(self.call('POST', '/api/privacy', {'optionalAnalytics': 'yes'}, self.cookie)[0], 400)
        with patch.object(app, 'OPERATORS', OperatorAccess()), patch.dict(os.environ, {'EXPRESSION_ADMIN_TOKEN': 'x' * 40}):
            self.assertEqual(self.call('GET', '/api/admin/analytics', cookie=self.cookie)[0], 403)
            response = self.call('POST', '/api/admin/session', {'accessCode': 'x' * 40}, self.cookie)
            self.assertEqual(response[0], 200)
            self.assertIn('HttpOnly', response[2]['Set-Cookie'])
            op = response[2]['Set-Cookie'].split(';')[0]
            self.assertEqual(self.call('GET', '/api/admin/analytics', cookie=self.cookie + '; ' + op)[1]['scope'], 'operator')
            self.assertEqual(self.call('GET', '/api/admin/analytics', cookie=self.other + '; ' + op)[0], 403)
            self.assertEqual(self.call('POST', '/api/admin/session', {'accessCode': 'x' * 40}, self.cookie, {'Origin': 'https://evil.example'})[0], 403)
            self.call('DELETE', '/api/admin/session', cookie=self.cookie + '; ' + op)
            self.assertEqual(self.call('GET', '/api/admin/analytics', cookie=self.cookie + '; ' + op)[0], 403)
