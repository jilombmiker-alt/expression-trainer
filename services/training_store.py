"""Single-host P0 persistence. Guest identity is not a cross-device account."""
import hashlib
import json
import secrets
import sqlite3
import time
import uuid
from contextlib import contextmanager
from pathlib import Path


class TrainingError(Exception):
    def __init__(self, code, message, status=400):
        super().__init__(message)
        self.code, self.message, self.status = code, message, status


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def encode(value):
    return json.dumps(value, ensure_ascii=False, allow_nan=False, sort_keys=True)


# Closed schemas: arbitrary strings, transcript, URLs and credentials are not accepted.
EVENT_FIELDS = {
    'step_viewed': {'step': (0, 6)},
    'reading_completed': {'round': (0, 1), 'durationMs': (0, 600000), 'endReason': {'manual', 'timeout'}},
    'microphone_permission_resolved': {'result': {'granted', 'denied', 'unavailable'}},
    'asr_finished': {'engine': {'browser', 'funasr'}, 'durationMs': (0, 3600000)},
    'asr_interrupted': {'reason': {'network', 'permission', 'no-speech', 'other'}},
    'transcript_confirmed': {'round': (0, 1)},
    'coach_hint_shown': {'round': (0, 1)},
    'training_resumed': {'step': (0, 6)},
}

WEIGHT_KEYS = {
    'first': {'oralControl', 'pauseRhythm', 'connectorLogic', 'paceFluency', 'centralAccuracy', 'keyCoverage', 'semanticConciseness'},
    'second': {'centralAccuracy', 'keyCoverage', 'compressionTime', 'pausePace', 'connectorLogic', 'oralControl', 'informationLogic'},
}


def validate_weights(chosen, round_name):
    if not isinstance(chosen, dict) or set(chosen) != WEIGHT_KEYS[round_name] or any(type(v) not in (int, float) or not 0 <= v <= 100 for v in chosen.values()) or sum(chosen.values()) != 100:
        raise TrainingError('invalid_weights', '各轮评分权重需完整且合计 100%。')
    return chosen


class TrainingStore:
    def __init__(self, path, clock=time.time):
        self.path, self.clock = Path(path), clock
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.db() as db:
            db.executescript('''
              PRAGMA journal_mode=WAL;
              CREATE TABLE IF NOT EXISTS guests(token_hash TEXT PRIMARY KEY, owner TEXT, expires REAL);
              CREATE TABLE IF NOT EXISTS resources(kind TEXT, resource_hash TEXT, owner TEXT,
                PRIMARY KEY(kind,resource_hash));
              CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY, owner TEXT, created REAL, payload TEXT);
              CREATE TABLE IF NOT EXISTS attempts(id TEXT PRIMARY KEY, owner TEXT, run_id TEXT, round INTEGER,
                mode TEXT, started REAL, submitted REAL, request_hash TEXT, result TEXT, processing REAL);
              CREATE TABLE IF NOT EXISTS events(id TEXT PRIMARY KEY, owner TEXT, name TEXT, received REAL,
                emitter TEXT, payload TEXT);
              CREATE INDEX IF NOT EXISTS attempts_owner ON attempts(owner,started);
              CREATE INDEX IF NOT EXISTS events_owner ON events(owner,received);
              CREATE INDEX IF NOT EXISTS runs_created_owner ON runs(created,owner);
              CREATE TABLE IF NOT EXISTS preferences(owner TEXT PRIMARY KEY, analytics INTEGER NOT NULL DEFAULT 0);
            ''')
            if 'weights' not in {row[1] for row in db.execute('PRAGMA table_info(attempts)')}:
                db.execute('ALTER TABLE attempts ADD COLUMN weights TEXT')

    @contextmanager
    def db(self):
        db = sqlite3.connect(self.path, timeout=10)
        db.row_factory = sqlite3.Row
        try:
            with db:
                yield db
        finally:
            db.close()

    def guest(self, token):
        with self.db() as db:
            row = db.execute('SELECT owner FROM guests WHERE token_hash=? AND expires>?', (digest(token), self.clock())).fetchone()
        return row['owner'] if row else None

    def privacy(self, owner, enabled=None):
        with self.db() as db:
            if enabled is not None:
                if type(enabled) is not bool:
                    raise TrainingError('invalid_preference', '请选择是否允许可选使用分析。')
                db.execute('INSERT INTO preferences(owner,analytics) VALUES(?,?) ON CONFLICT(owner) DO UPDATE SET analytics=excluded.analytics', (owner, int(enabled)))
            row = db.execute('SELECT analytics FROM preferences WHERE owner=?', (owner,)).fetchone()
        return {'optionalAnalytics': bool(row['analytics']) if row else False}

    def create_guest(self):
        token, owner = secrets.token_urlsafe(32), str(uuid.uuid4())
        with self.db() as db:
            db.execute('DELETE FROM guests WHERE expires<=?', (self.clock(),))
            db.execute('INSERT INTO guests VALUES(?,?,?)', (digest(token), owner, self.clock() + 30 * 86400))
        return token, owner

    def bind(self, owner, kind, resource_id):
        with self.db() as db:
            db.execute('INSERT INTO resources VALUES(?,?,?)', (kind, digest(resource_id), owner))

    def require_resource(self, owner, kind, resource_id):
        if not isinstance(resource_id, str) or not resource_id or len(resource_id) > 128:
            raise TrainingError('resource_not_found', '记录不存在，或不属于当前用户。', 404)
        with self.db() as db:
            row = db.execute('SELECT owner FROM resources WHERE kind=? AND resource_hash=?', (kind, digest(resource_id))).fetchone()
        if not row or row['owner'] != owner:
            raise TrainingError('resource_not_found', '记录不存在，或不属于当前用户。', 404)

    def create_run(self, owner, payload):
        with self.db() as db:
            count = db.execute('SELECT count(*) FROM runs WHERE owner=? AND created>?', (owner, self.clock() - 3600)).fetchone()[0]
            if count >= 60:
                raise TrainingError('rate_limited', '创建训练过于频繁，请稍后再试。', 429)
            run_id = str(uuid.uuid4())
            db.execute('INSERT INTO runs VALUES(?,?,?,?)', (run_id, owner, self.clock(), encode(payload)))
        self.server_event(owner, 'training_started', {'trainingId': run_id, 'schemaVersion': 1})
        return {'id': run_id}

    def run(self, owner, run_id):
        if not isinstance(run_id, str) or len(run_id) != 36:
            raise TrainingError('run_not_found', '训练不存在，请返回选题重新开始。', 404)
        with self.db() as db:
            row = db.execute('SELECT payload FROM runs WHERE owner=? AND id=?', (owner, run_id)).fetchone()
        if not row:
            raise TrainingError('run_not_found', '训练不存在，请返回选题重新开始。', 404)
        return json.loads(row['payload'])

    def start_attempt(self, owner, run_id, round_index, mode, attempt_id, weights=None):
        run = self.run(owner, run_id)
        if type(round_index) is not int or round_index not in (0, 1) or mode not in ('independent', 'guided', 'demo'):
            raise TrainingError('invalid_attempt', '训练轮次或模式不正确。')
        round_name = 'first' if round_index == 0 else 'second'
        weights = validate_weights(weights if weights is not None else run['weights'][round_name], round_name)
        try:
            uuid.UUID(attempt_id)
        except (ValueError, TypeError, AttributeError):
            raise TrainingError('invalid_attempt', '作答编号不正确。') from None
        with self.db() as db:
            db.execute('BEGIN IMMEDIATE')
            old = db.execute('SELECT * FROM attempts WHERE id=?', (attempt_id,)).fetchone()
            if old:
                if (old['owner'], old['run_id'], old['round'], old['mode']) != (owner, run_id, round_index, mode) or (old['weights'] and old['weights'] != encode(weights)):
                    raise TrainingError('attempt_conflict', '作答编号已被使用。', 409)
                return {'id': attempt_id}
            if round_index == 1 and not db.execute('SELECT id FROM attempts WHERE owner=? AND run_id=? AND round=0 AND result IS NOT NULL', (owner, run_id)).fetchone():
                raise TrainingError('round_order_invalid', '请先完成第一轮分析。', 409)
            if db.execute('SELECT count(*) FROM attempts WHERE run_id=?', (run_id,)).fetchone()[0] >= 50:
                raise TrainingError('rate_limited', '本次训练作答次数已达上限，请重新选题。', 429)
            db.execute('INSERT INTO attempts(id,owner,run_id,round,mode,started,weights) VALUES(?,?,?,?,?,?,?)',
                       (attempt_id, owner, run_id, round_index, mode, self.clock(), encode(weights)))
        return {'id': attempt_id}

    def reserve(self, owner, attempt_id, request):
        if not isinstance(attempt_id, str) or len(attempt_id) != 36:
            raise TrainingError('attempt_not_found', '作答不存在，请重新进入转述环节。', 404)
        request_hash = digest(encode(request))
        with self.db() as db:
            db.execute('BEGIN IMMEDIATE')
            row = db.execute('SELECT * FROM attempts WHERE id=? AND owner=?', (attempt_id, owner)).fetchone()
            if not row:
                raise TrainingError('attempt_not_found', '作答不存在，请重新进入转述环节。', 404)
            if row['request_hash'] and row['request_hash'] != request_hash:
                raise TrainingError('submission_conflict', '本次提交已锁定。请重试原提交，或重新作答。', 409)
            if row['result']:
                return dict(row), json.loads(row['result'])
            if row['processing'] and self.clock() - row['processing'] < 150:
                raise TrainingError('assessment_processing', '正在分析本次作答，请稍后重试。', 409)
            submitted = row['submitted'] if row['submitted'] is not None else self.clock()
            db.execute('UPDATE attempts SET submitted=?,request_hash=?,processing=? WHERE id=?', (submitted, request_hash, self.clock(), attempt_id))
            return {**dict(row), 'submitted': submitted}, None

    def release(self, owner, attempt_id):
        with self.db() as db:
            db.execute('UPDATE attempts SET processing=NULL WHERE id=? AND owner=?', (attempt_id, owner))

    def finish(self, owner, attempt_id, result):
        with self.db() as db:
            db.execute('UPDATE attempts SET result=?,processing=NULL WHERE id=? AND owner=?', (encode(result), attempt_id, owner))
            payload = {key: result['assessment'][key] for key in ('trainingId', 'attemptId', 'round', 'mode', 'scoringVersion', 'fallbackCode')}
            payload.update(total=result['scoring']['total'], provisional=result['scoring']['provisional'], invalid=result['scoring']['invalid'], components=result['scoring']['components'])
            db.execute('INSERT OR IGNORE INTO events VALUES(?,?,?,?,?,?)',
                       ('assessment-' + attempt_id, owner, 'assessment_finished', self.clock(), 'server', encode(payload)))

    def records(self, owner):
        with self.db() as db:
            rows = db.execute('SELECT result FROM attempts WHERE owner=? AND result IS NOT NULL ORDER BY started DESC LIMIT 100', (owner,)).fetchall()
        return {'records': [json.loads(row['result']) for row in rows]}

    def client_events(self, owner, events):
        if not isinstance(events, list) or not 1 <= len(events) <= 20:
            raise TrainingError('invalid_events', '每次需提交 1–20 条事件。')
        clean = []
        for event in events:
            if not isinstance(event, dict) or event.get('name') not in EVENT_FIELDS:
                raise TrainingError('invalid_event', '不支持这个事件。')
            try:
                uuid.UUID(event.get('id', ''))
            except (ValueError, TypeError, AttributeError):
                raise TrainingError('invalid_event', '事件编号不正确。') from None
            fields = EVENT_FIELDS[event['name']]
            data = event.get('data', {})
            if not isinstance(data, dict) or set(data) - set(fields):
                raise TrainingError('invalid_event', '事件包含未允许的字段。')
            for key, value in data.items():
                rule = fields[key]
                valid = (type(value) in (int, float) and rule[0] <= value <= rule[1]) if isinstance(rule, tuple) else (isinstance(value, str) and value in rule)
                if not valid:
                    raise TrainingError('invalid_event', '事件字段值不正确。')
            run_id = event.get('trainingId')
            if run_id is not None:
                self.run(owner, run_id)
            occurred = event.get('occurredAt')
            if type(occurred) not in (int, float) or not 0 <= occurred <= (self.clock() + 60) * 1000:
                raise TrainingError('invalid_event', '事件时间不正确。')
            clean.append((event['id'], event['name'], {**data, 'trainingId': run_id, 'occurredAt': occurred}))
        with self.db() as db:
            db.execute('BEGIN IMMEDIATE')
            if db.execute('SELECT count(*) FROM events WHERE owner=? AND received>?', (owner, self.clock() - 60)).fetchone()[0] + len(clean) > 300:
                raise TrainingError('rate_limited', '事件上传过于频繁。', 429)
            for event_id, name, data in clean:
                db.execute('INSERT OR IGNORE INTO events VALUES(?,?,?,?,?,?)', (owner + ':' + event_id, owner, name, self.clock(), 'client', encode({'schemaVersion': 1, **data})))
        return {'accepted': len(clean)}

    def server_event(self, owner, name, payload):
        with self.db() as db:
            db.execute('INSERT INTO events VALUES(?,?,?,?,?,?)', (str(uuid.uuid4()), owner, name, self.clock(), 'server', encode(payload)))
