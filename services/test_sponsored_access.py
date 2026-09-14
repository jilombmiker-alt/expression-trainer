import base64
import os
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import patch

import sponsored_access as sponsor
from training_store import TrainingError, TrainingStore
import test_training_backend as fixture
from test_training_backend import EXERCISE, TEXT, WEIGHTS

ENV = dict(EXPRESSION_MODEL_MODE='sponsored', EXPRESSION_BETA_PASSWORD='test-beta-password-only',
           EXPRESSION_LLM_PROVIDER='deepseek', EXPRESSION_LLM_MODEL='deepseek-chat',
           EXPRESSION_LLM_API_KEY='sk-test-only-not-a-real-key', EXPRESSION_SPONSORED_DAILY_LIMIT='2')
AUTH = 'Basic ' + base64.b64encode(('beta:' + ENV['EXPRESSION_BETA_PASSWORD']).encode()).decode()


class SponsoredUnitTests(unittest.TestCase):
    def test_mode_default_and_explicit_configuration(self):
        self.assertFalse(sponsor.enabled({}))
        sponsor.validate(ENV)
        for field, value in [('EXPRESSION_BETA_PASSWORD', ''), ('EXPRESSION_LLM_API_KEY', ''), ('EXPRESSION_SPONSORED_DAILY_LIMIT', '0')]:
            with self.subTest(field=field), self.assertRaises(Exception):
                sponsor.validate({**ENV, field: value})

    def test_invitation_not_model_key(self):
        self.assertTrue(sponsor.authorized(AUTH, ENV))
        for header in [None, '', 'Bearer test', 'Basic !!!', 'Basic ' + base64.b64encode(b'beta:wrong-password').decode()]:
            self.assertFalse(sponsor.authorized(header, ENV))

    def test_atomic_daily_budget_survives_restart_and_resets_next_day(self):
        with tempfile.TemporaryDirectory() as temp, patch.dict(os.environ, ENV):
            path = Path(temp) / 'budget.sqlite3'
            store = TrainingStore(path, clock=lambda: 86400)
            def charge(_):
                try: sponsor.consume(store); return True
                except TrainingError as error:
                    self.assertEqual(error.code, 'beta_daily_limit'); return False
            with ThreadPoolExecutor(max_workers=8) as pool:
                self.assertEqual(sum(pool.map(charge, range(8))), 2)
            with self.assertRaises(TrainingError): sponsor.consume(TrainingStore(path, clock=lambda: 86400))
            sponsor.consume(TrainingStore(path, clock=lambda: 172800))


class SponsoredHTTPTests(unittest.TestCase):
    # Reuse only the fixture/request helper, not the entire test class's test methods.
    setUp = fixture.HTTPTrainingTests.setUp
    call = fixture.HTTPTrainingTests.call

    def test_all_entrypoints_require_beta_password_and_health_never_contains_key(self):
        with patch.dict(os.environ, ENV):
            for method, path in [('GET', '/settings.html'), ('GET', '/api/semantic/health'), ('POST', '/api/semantic/evaluate'), ('HEAD', '/settings.html')]:
                response = self.call(method, path, cookie=self.cookie)
                self.assertEqual(response[0], 401)
                self.assertIn('Basic', response[2]['WWW-Authenticate'])
            status, health, _ = self.call('GET', '/api/semantic/health', cookie=self.cookie, headers={'Authorization': AUTH})
            self.assertEqual(status, 200)
            self.assertEqual(health['billingMode'], 'sponsored')
            self.assertFalse(health['byokRequired'])
            self.assertNotIn(ENV['EXPRESSION_LLM_API_KEY'], str(health))

    def test_legacy_endpoint_budget_and_no_automatic_retries(self):
        import p0_service as app
        with patch.dict(os.environ, ENV), patch.object(app, 'evaluate_semantic', return_value={'_meta': {}}) as remote:
            request = {'exercise': EXERCISE, 'transcript': TEXT}
            for _ in range(2):
                self.assertEqual(self.call('POST', '/api/semantic/evaluate', request, self.cookie, {'Authorization': AUTH})[0], 200)
            self.assertEqual(self.call('POST', '/api/semantic/evaluate', request, self.cookie, {'Authorization': AUTH})[0], 429)
            self.assertEqual(remote.call_count, 2)
            self.assertEqual(remote.call_args.kwargs['settings']['retries'], 0)
            self.assertEqual(remote.call_args.kwargs['settings']['provider'], 'deepseek')
            self.assertEqual(remote.call_args.kwargs['settings']['thinkingMode'], 'disabled')

    def test_shared_attempt_needs_no_client_key_and_cached_result_does_not_charge_again(self):
        import json
        import uuid
        import p0_service as app
        with patch.dict(os.environ, ENV), patch.object(app, 'evaluate_semantic', return_value={'_meta': {}}) as remote:
            headers = {'Authorization': AUTH}
            run = self.call('POST', '/api/training/runs', {'rounds': [EXERCISE, EXERCISE], 'weights': WEIGHTS}, self.cookie, headers)[1]
            attempt_id = str(uuid.uuid4())
            self.call('POST', '/api/training/attempts', {'trainingId': run['id'], 'round': 0, 'mode': 'independent', 'id': attempt_id}, self.cookie, headers)
            self.now += 60
            request = {'attemptId': attempt_id, 'transcript': TEXT, 'timing': {'elapsedSeconds': 60}}
            status, result, _ = self.call('POST', '/api/training/assess', request, self.cookie, headers)
            self.assertEqual(status, 200)
            self.assertNotIn(ENV['EXPRESSION_LLM_API_KEY'], json.dumps(result))
            self.assertEqual(self.call('POST', '/api/training/assess', request, self.cookie, headers)[0], 200)
            self.assertEqual(remote.call_count, 1)
            with self.store.db() as db:
                self.assertEqual(db.execute('SELECT used FROM sponsored_budget').fetchone()[0], 1)
