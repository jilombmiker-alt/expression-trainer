"""Validated multi-provider semantic assessment for P0."""
import json
import os
import time
import urllib.error
import urllib.request
from pathlib import Path

from model_connections import ModelConnectionError, request_model, validate_settings

PROMPT_VERSION = "semantic_assessment_v1"
PROMPT_PATH = Path(__file__).resolve().parent / "prompts" / f"{PROMPT_VERSION}.txt"
ALLOWED_STATUSES = {"matched", "missing", "conflict"}
ALLOWED_RELATIONS = {"cause", "contrast", "condition", "sequence", "action", "conclusion"}


class SemanticServiceError(Exception):
    def __init__(self, code, message, status=502, retryable=False, internal=""):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status
        self.retryable = retryable
        self.internal = internal


def configured(environ=None):
    env = environ or os.environ
    return bool(env.get("EXPRESSION_LLM_API_KEY") and env.get("EXPRESSION_LLM_MODEL"))


def config(environ=None):
    env = environ or os.environ
    if not configured(env):
        raise SemanticServiceError("semantic_model_unavailable", "未配置语义模型，当前只能使用本地暂定分析。", 503)
    try:
        timeout = max(3, min(90, int(env.get("EXPRESSION_LLM_TIMEOUT_SECONDS", "30"))))
        retries = max(0, min(2, int(env.get("EXPRESSION_LLM_RETRIES", "1"))))
    except ValueError as exc:
        raise SemanticServiceError("semantic_config_invalid", "语义模型配置格式不正确。", 503, internal=str(exc))
    settings = validate_settings(
        env.get("EXPRESSION_LLM_PROVIDER", "openai"),
        env["EXPRESSION_LLM_MODEL"],
        env["EXPRESSION_LLM_API_KEY"],
        env,
    )
    settings.update({"timeout": timeout, "retries": retries})
    return settings


def clean_text(value, maximum):
    text = str(value or "").strip()
    return text[:maximum]


def validate_request(data):
    if not isinstance(data, dict):
        raise SemanticServiceError("invalid_request", "请求必须是 JSON 对象。", 400)
    exercise = data.get("exercise")
    if not isinstance(exercise, dict):
        raise SemanticServiceError("invalid_exercise", "训练材料格式不完整。", 400)
    source = clean_text(exercise.get("text"), 5000)
    central = clean_text(exercise.get("central"), 500)
    raw_concepts = exercise.get("concepts")
    if not source or not central or not isinstance(raw_concepts, list) or not 3 <= len(raw_concepts) <= 5:
        raise SemanticServiceError("invalid_exercise", "训练材料需要原文、中心思想和 3–5 个概念组。", 400)
    concepts = []
    labels = set()
    for raw in raw_concepts:
        label = clean_text(raw.get("label") if isinstance(raw, dict) else "", 40)
        if not label or label in labels:
            raise SemanticServiceError("invalid_exercise", "概念名称不能为空或重复。", 400)
        labels.add(label)
        terms = [clean_text(item, 30) for item in (raw.get("terms") or []) if clean_text(item, 30)] if isinstance(raw, dict) else []
        concepts.append({"label": label, "terms": terms[:12] or [label]})
    transcript = clean_text(data.get("transcript"), 8000)
    if not transcript:
        raise SemanticServiceError("invalid_transcript", "请先完成转述。", 400)
    return {"exercise": {"text": source, "central": central, "concepts": concepts}, "transcript": transcript}


def build_prompt(validated):
    template = PROMPT_PATH.read_text(encoding="utf-8")
    exercise_json = json.dumps(validated["exercise"], ensure_ascii=False, separators=(",", ":"))
    return template.replace("{{EXERCISE_JSON}}", exercise_json).replace("{{TRANSCRIPT}}", validated["transcript"])


def normalize_output(value, validated):
    if not isinstance(value, dict) or not isinstance(value.get("concepts"), list):
        raise SemanticServiceError("semantic_output_invalid", "语义模型返回格式不正确。", 502, True)
    expected = [item["label"] for item in validated["exercise"]["concepts"]]
    received = value["concepts"]
    if len(received) != len(expected):
        raise SemanticServiceError("semantic_output_invalid", "语义模型没有逐项返回全部概念。", 502, True)
    normalized = []
    seen = set()
    transcript = validated["transcript"]
    for item in received:
        if not isinstance(item, dict):
            raise SemanticServiceError("semantic_output_invalid", "语义模型概念项格式不正确。", 502, True)
        label = clean_text(item.get("label"), 40)
        status = item.get("status")
        evidence = clean_text(item.get("evidence"), 120)
        try:
            confidence = float(item.get("confidence"))
        except (TypeError, ValueError):
            raise SemanticServiceError("semantic_output_invalid", "语义模型置信度格式不正确。", 502, True)
        if label not in expected or label in seen or status not in ALLOWED_STATUSES or not 0 <= confidence <= 1:
            raise SemanticServiceError("semantic_output_invalid", "语义模型概念项不符合约定。", 502, True)
        if status in {"matched", "conflict"} and (not evidence or evidence not in transcript):
            raise SemanticServiceError("semantic_output_invalid", "语义证据必须来自用户转述。", 502, True)
        if status == "missing":
            evidence = ""
        seen.add(label)
        normalized.append({"label": label, "status": status, "evidence": evidence, "confidence": round(confidence, 3)})
    if seen != set(expected):
        raise SemanticServiceError("semantic_output_invalid", "语义模型返回的概念集合不完整。", 502, True)
    by_label = {item["label"]: item for item in normalized}
    relations = []
    for item in value.get("relations", []) if isinstance(value.get("relations", []), list) else []:
        if not isinstance(item, dict) or item.get("type") not in ALLOWED_RELATIONS:
            continue
        evidence = clean_text(item.get("evidence"), 120)
        if evidence and evidence in transcript:
            relations.append({"type": item["type"], "evidence": evidence})
    return {"concepts": [by_label[label] for label in expected], "relations": relations[:8]}


def parse_remote_response(content, validated):
    try:
        value = json.loads(content) if isinstance(content, str) else content
    except (TypeError, json.JSONDecodeError) as exc:
        raise SemanticServiceError("semantic_output_invalid", "语义模型返回格式不正确。", 502, True, str(exc))
    return normalize_output(value, validated)


def evaluate(data, opener=None, sleeper=None, environ=None, clock=None, settings=None):
    validated = validate_request(data)
    settings = dict(settings or config(environ))
    sleep = sleeper or time.sleep
    now = clock or time.monotonic
    prompt = build_prompt(validated)
    started = now()
    last_error = None
    for attempt in range(settings["retries"] + 1):
        try:
            content, usage, _remote = request_model(settings, prompt, opener=opener, max_tokens=1200, json_mode=True)
            result = parse_remote_response(content, validated)
            result["_meta"] = {
                "model": settings["model"], "promptVersion": PROMPT_VERSION,
                "latencyMs": round((now() - started) * 1000),
                "attempts": attempt + 1, "usage": {key: usage.get(key) for key in ("prompt_tokens", "completion_tokens", "total_tokens") if usage.get(key) is not None},
            }
            return result
        except SemanticServiceError as exc:
            last_error = exc
        except ModelConnectionError as exc:
            last_error = SemanticServiceError(exc.code, exc.message, exc.status, exc.retryable, exc.internal)
        if not last_error.retryable or attempt >= settings["retries"]:
            break
        sleep(0.2 * (attempt + 1))
    raise last_error or SemanticServiceError("semantic_model_failed", "语义模型暂时不可用。")


def health(environ=None):
    env = environ or os.environ
    return {"available": configured(env), "model": env.get("EXPRESSION_LLM_MODEL", ""), "promptVersion": PROMPT_VERSION}
