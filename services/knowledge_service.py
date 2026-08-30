"""Grounded, deterministic training-card generation from user supplied text."""
import hashlib
import re


class KnowledgeServiceError(Exception):
    def __init__(self, code, message, status=400):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status


def clean(value, maximum=30000):
    return re.sub(r"\s+", " ", str(value or "")).strip()[:maximum]


def count_chars(value):
    return len(re.sub(r"\s+", "", str(value or "")))


def sentences(value):
    return [item.strip() for item in re.split(r"(?<=[。！？；!?;])", clean(value)) if count_chars(item) >= 12]


def join_until(items, minimum, maximum):
    chosen = []
    for item in items:
        if chosen and count_chars("".join(chosen)) >= minimum:
            break
        if count_chars("".join(chosen) + item) <= maximum or not chosen:
            chosen.append(item)
    text = "".join(chosen)
    return text if count_chars(text) <= maximum else text[:maximum]


def phrase_candidates(text):
    values = []
    for sentence in sentences(text):
        for part in re.split(r"[，、：,:]", sentence):
            value = re.sub(r"[。！？；!?;]", "", part).strip()
            if 4 <= count_chars(value) <= 22:
                values.append(value)
    return values


def concepts_for(text, keywords):
    source = clean(text)
    requested = [clean(item, 30) for item in re.split(r"[,，、\s]+", clean(keywords, 300)) if clean(item, 30)]
    requested = [item for item in requested if item in source]
    candidates = requested + phrase_candidates(source)
    unique = []
    for item in candidates:
        label = item[:12]
        if label and label not in unique:
            unique.append(label)
    if len(unique) < 3:
        raise KnowledgeServiceError("knowledge_concepts_insufficient", "资料中的可识别信息点不足，请补充更完整的句子或关键词。")
    return [{"label": item, "terms": [item]} for item in unique[:4]]


def build_card(data):
    if not isinstance(data, dict):
        raise KnowledgeServiceError("invalid_request", "知识训练请求必须是 JSON 对象。")
    topic = clean(data.get("topic"), 80)
    source = clean(data.get("source"), 30000)
    source_name = clean(data.get("sourceName"), 180) or "用户在网页中提供的资料"
    if not topic:
        raise KnowledgeServiceError("topic_required", "请先填写想训练的知识主题。")
    if count_chars(source) < 220:
        raise KnowledgeServiceError("source_too_short", "资料至少需要约 220 个有效字。")
    parts = sentences(source)
    if len(parts) < 4:
        raise KnowledgeServiceError("source_structure_insufficient", "资料至少需要 4 个完整句子，请保留句号或分号。")
    midpoint = max(2, len(parts) // 2)
    first = join_until(parts[:midpoint], 100, 220)
    second = join_until(parts[midpoint:], 80, 160)
    if count_chars(first) < 100 or count_chars(second) < 80 or first == second:
        raise KnowledgeServiceError("rounds_cannot_split", "资料前后信息分布不够完整，暂时无法生成两篇不同练习。")
    first_concepts = concepts_for(first, data.get("keywords"))
    second_concepts = concepts_for(second, data.get("keywords"))
    digest = hashlib.sha256(f"{topic}\n{source}".encode("utf-8")).hexdigest()[:12]
    first_sentences = sentences(first)
    second_sentences = sentences(second)
    return {
        "schemaVersion": 1,
        "id": f"source-{digest}", "title": topic, "audience": "用户自定义",
        "sourceMode": "supplied-file", "sourceRefs": [source_name],
        "knowledge": {
            "definition": first_sentences[0] if first_sentences else first,
            "context": first_sentences[1] if len(first_sentences) > 1 else "来源未单独说明背景。",
            "mechanism": first_sentences[2:5], "applications": second_sentences[:2],
            "boundaries": ["本训练卡只依据用户提供的资料，不补充资料外结论。"],
            "extensions": [f"如何把“{topic}”迁移到新的实际场景？"],
        },
        "rounds": [
            {"mode": "long-retell", "title": f"{topic} · 理解与转述", "text": first, "central": first_sentences[0], "concepts": first_concepts},
            {"mode": "30-second-recall", "title": f"{topic} · 快速抓取", "text": second, "central": second_sentences[0], "concepts": second_concepts},
        ],
        "challenge": {
            "prepMinutes": 15, "answerMinutes": 10,
            "prompt": f"请依据资料解释“{topic}”的含义、背景、机制、应用、边界与延伸。",
            "requiredDimensions": ["meaning", "context", "mechanism", "application", "boundary-counterexample", "extension"],
        },
        "generator": "grounded-rule-v1",
        "generationBoundary": "当前由后端来源约束规则生成，尚未经过 AI 语义改写；所有训练内容均来自本次资料。",
    }

