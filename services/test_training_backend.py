import contextlib
import functools
import http.client
import io
import json
import tempfile
import threading
import unittest
import uuid
from pathlib import Path
from unittest.mock import patch
from http.server import ThreadingHTTPServer

import p0_service as app
from audio_tasks import AudioTaskStore
from model_connections import ModelConnectionStore
from semantic_service import SemanticServiceError, normalize_usage
from training_store import TrainingStore, TrainingError

WEIGHTS = {
    'first': dict(oralControl=25, pauseRhythm=20, connectorLogic=15, paceFluency=10, centralAccuracy=5, keyCoverage=20, semanticConciseness=5),
    'second': dict(centralAccuracy=35, keyCoverage=15, compressionTime=5, pausePace=10, connectorLogic=10, oralControl=15, informationLogic=10),
}
EXERCISE = {'text': '反馈需要及时。通过具体事实解释问题，明确行动，并约定复盘时间。', 'central': '有效反馈要有事实和行动。',
            'concepts': [{'label': term, 'terms': [term]} for term in ('及时', '事实', '行动', '复盘')]}
TEXT = '有效反馈的核心是及时沟通，首先要结合具体事实解释问题，其次应该明确后续行动，最后需要约定复盘时间。'


class PersistenceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.now = 1000
        self.store = TrainingStore(Path(self.temp.name) / 'test.sqlite3', clock=lambda: self.now)

    def test_guest_tokens_are_hashed_persistent_and_expiring(self):
        token, owner = self.store.create_guest()
        self.assertEqual(self.store.guest(token), owner)
        with self.store.db() as db:
            self.assertNotEqual(db.execute('SELECT token_hash FROM guests').fetchone()[0], token)
        self.assertEqual(TrainingStore(self.store.path, clock=lambda: self.now).guest(token), owner)
        self.now += 31 * 86400
        self.assertIsNone(self.store.guest(token))

    def test_resources_are_isolated_and_legacy_unknown_is_denied(self):
        self.store.bind('alice', 'model', 'secret-connection')
        self.store.require_resource('alice', 'model', 'secret-connection')
        for owner, target in [('bob', 'secret-connection'), ('alice', 'legacy-connection')]:
            with self.assertRaises(TrainingError):
                self.store.require_resource(owner, 'model', target)

    def test_telemetry_schema_rejects_secrets_and_client_grades_and_deduplicates(self):
        item = {'id': str(uuid.uuid4()), 'name': 'step_viewed', 'data': {'step': 2}, 'occurredAt': 1000000}
        self.store.client_events('a', [item]); self.store.client_events('a', [item])
        with self.store.db() as db:
            self.assertEqual(db.execute('SELECT count(*) FROM events').fetchone()[0], 1)
        for item in [{**item, 'data': {'apiKey': 'do-not-store'}}, {**item, 'name': 'assessment_finished'}, {**item, 'data': {'step': float('nan')}}]:
            with self.assertRaises(TrainingError):
                self.store.client_events('a', [item])

    def test_usage_normalization_preserves_unknown_and_zero(self):
        self.assertEqual(normalize_usage({}), {})
        self.assertEqual(normalize_usage({'input_tokens': 10, 'output_tokens': 0}), {'prompt_tokens': 10, 'completion_tokens': 0, 'total_tokens': 10})
        self.assertEqual(normalize_usage({'promptTokenCount': 5, 'candidatesTokenCount': 3, 'totalTokenCount': 11})['total_tokens'], 11)

    def test_attempt_order_weights_and_processing_lease(self):
        run_id = self.store.create_run('a', {'rounds': [EXERCISE, EXERCISE], 'weights': WEIGHTS})['id']
        with self.assertRaises(TrainingError):
            self.store.start_attempt('a', run_id, 1, 'independent', str(uuid.uuid4()))
        attempt_id = str(uuid.uuid4())
        self.store.start_attempt('a', run_id, 0, 'independent', attempt_id)
        with self.assertRaises(TrainingError):
            self.store.start_attempt('a', run_id, 0, 'independent', attempt_id, {**WEIGHTS['first'], 'oralControl': 100})
        self.now += 30
        first, _ = self.store.reserve('a', attempt_id, {'transcript': TEXT})
        with self.assertRaises(TrainingError):
            self.store.reserve('a', attempt_id, {'transcript': TEXT})
        self.now += 151
        second, _ = self.store.reserve('a', attempt_id, {'transcript': TEXT})
        self.assertEqual(second['submitted'], first['submitted'])

    def test_telemetry_cannot_reference_another_users_training(self):
        run_id = self.store.create_run('a', {'rounds': [EXERCISE, EXERCISE], 'weights': WEIGHTS})['id']
        with self.assertRaises(TrainingError):
            self.store.client_events('b', [{'id': str(uuid.uuid4()), 'name': 'step_viewed', 'data': {'step': 2}, 'occurredAt': 1000000, 'trainingId': run_id}])


class HTTPTrainingTests(unittest.TestCase):
    def test_production_cookie_and_host_boundary(self):
        with patch.dict(app.os.environ, {'EXPRESSION_SECURE_COOKIE': 'true'}):
            headers = self.call('GET', '/api/session')[2]
            self.assertIn('; Secure', headers['Set-Cookie'])
        with patch.object(app, 'PUBLIC_HOST', 'training.example.com'):
            self.assertEqual(self.call('GET', '/api/speech/health')[0], 403)
            self.assertEqual(self.call('GET', '/api/speech/health', headers={'Host': 'training.example.com'})[0], 200)

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.now = 1000
        self.store = TrainingStore(Path(self.temp.name) / 'test.sqlite3', clock=lambda: self.now)
        for name, value in [('TRAINING', self.store), ('MODEL_CONNECTIONS', ModelConnectionStore()), ('AUDIO_TASKS', AudioTaskStore(Path(self.temp.name) / 'audio'))]:
            mock = patch.object(app, name, value); mock.start(); self.addCleanup(mock.stop)
        handler = functools.partial(app.Handler, directory=str(Path(__file__).resolve().parents[1] / 'web'))
        self.server = ThreadingHTTPServer(('127.0.0.1', 0), handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)
        self.cookie = self.call('GET', '/api/session')[2]['Set-Cookie'].split(';')[0]
        self.other = self.call('GET', '/api/session')[2]['Set-Cookie'].split(';')[0]
        self.connection = self.call('POST', '/api/model-connections', {'provider': 'openai', 'model': 'test-model', 'apiKey': 'sk-test-only-12345678'}, self.cookie)[1]['connectionId']

    def call(self, method, path, body=None, cookie=None, headers=None):
        conn = http.client.HTTPConnection('127.0.0.1', self.server.server_port, timeout=10)
        base = {'Content-Type': 'application/json'}
        if cookie:
            base['Cookie'] = cookie
        base.update(headers or {})
        conn.request(method, path, json.dumps(body) if body is not None else None, base)
        res = conn.getresponse()
        raw = res.read()
        result = (res.status, None if method == 'HEAD' else json.loads(raw), dict(res.getheaders()))
        conn.close()
        return result

    def setup_attempt(self):
        status, run, _ = self.call('POST', '/api/training/runs', {'rounds': [EXERCISE, EXERCISE], 'weights': WEIGHTS}, self.cookie)
        self.assertEqual(status, 201)
        attempt_id = str(uuid.uuid4())
        self.assertEqual(self.call('POST', '/api/training/attempts', {'trainingId': run['id'], 'round': 0, 'mode': 'independent', 'id': attempt_id}, self.cookie)[0], 201)
        self.now += 30
        return {'attemptId': attempt_id, 'transcript': TEXT, 'timing': {'elapsedSeconds': 30}, 'total': 999, 'components': {'oralControl': 999}}

    def test_auth_cross_origin_and_resource_isolation(self):
        self.assertEqual(self.call('GET', '/api/training/records')[0], 401)
        self.assertEqual(self.call('GET', '/api/model-connections/' + self.connection, cookie=self.other)[0], 404)
        self.assertEqual(self.call('DELETE', '/api/model-connections/' + self.connection, cookie=self.other)[0], 404)
        self.assertEqual(self.call('POST', '/api/events', {}, self.cookie, {'Origin': 'https://evil.example'})[0], 403)
        task = self.call('POST', '/api/audio/tasks', {'contentType': 'audio/webm'}, self.cookie)[1]
        self.assertEqual(self.call('GET', '/api/audio/tasks/' + task['id'], cookie=self.other)[0], 404)
        self.assertEqual(self.call('DELETE', '/api/audio/tasks/' + task['id'], cookie=self.other)[0], 404)

    def test_invalid_json_shape_has_stable_error(self):
        for endpoint in ['/api/training/runs', '/api/training/attempts', '/api/training/assess', '/api/events', '/api/model-connections']:
            status, result, _ = self.call('POST', endpoint, [], self.cookie)
            self.assertEqual(status, 400)
            self.assertEqual(result['error']['code'], 'invalid_request')

    def test_server_recalculates_and_idempotently_persists_without_ai_wait(self):
        request = self.setup_attempt()
        def model(*args, **kwargs):
            self.now += 60  # Simulate provider latency without sleeping.
            return {'concepts': [{'label': c['label'], 'status': 'matched', 'evidence': c['label']} for c in EXERCISE['concepts']]}
        headers = {'X-Model-Connection': self.connection}
        with patch.object(app, 'evaluate_semantic', side_effect=model) as remote:
            status, result, _ = self.call('POST', '/api/training/assess', request, self.cookie, headers)
            self.assertEqual(status, 200, result)
            self.assertEqual(result['elapsed'], 30)
            self.assertNotEqual(result['scoring']['total'], 999)
            self.assertTrue(result['scoring']['provisional'])
            self.assertEqual(self.call('POST', '/api/training/assess', request, self.cookie, headers)[1], result)
            self.assertEqual(remote.call_count, 1)
        self.assertEqual(len(self.call('GET', '/api/training/records', cookie=self.cookie)[1]['records']), 1)
        self.assertEqual(self.call('GET', '/api/training/records', cookie=self.other)[1]['records'], [])
        self.assertEqual(self.call('POST', '/api/training/assess', {**request, 'transcript': 'changed'}, self.cookie, headers)[0], 409)
        with self.store.db() as db:
            rows = db.execute("SELECT payload FROM events WHERE name='assessment_finished'").fetchall()
            self.assertEqual(len(rows), 1)
            self.assertNotIn(TEXT, rows[0][0])
            self.assertNotIn(self.connection, rows[0][0])

    def test_provider_failure_does_not_create_zero_grade_and_can_retry(self):
        request = self.setup_attempt()
        with patch.object(app, 'evaluate_semantic', side_effect=SemanticServiceError('model_timeout', '稍后重试。', 503)):
            status, _, _ = self.call('POST', '/api/training/assess', request, self.cookie, {'X-Model-Connection': self.connection})
        self.assertEqual(status, 503)
        self.assertEqual(self.call('GET', '/api/training/records', cookie=self.cookie)[1]['records'], [])
        with self.store.db() as db:
            row = db.execute('SELECT submitted,processing,result FROM attempts').fetchone()
            self.assertEqual(row['submitted'], 1030)
            self.assertIsNone(row['processing'])
            self.assertIsNone(row['result'])

    def test_logs_do_not_include_connection_ids_or_query_content(self):
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            self.call('GET', '/api/model-connections/' + self.connection + '?secret=never-log-this', cookie=self.cookie)
        self.assertNotIn(self.connection, output.getvalue())
        self.assertNotIn('never-log-this', output.getvalue())


if __name__ == '__main__':
    unittest.main()
