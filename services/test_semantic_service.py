import json
import unittest

from semantic_service import SemanticServiceError, build_prompt, evaluate, normalize_output, validate_request


REQUEST = {
    "exercise": {
        "text": "注册步骤过多会导致用户退出，因此应该先缩短流程，再验证完成率。",
        "central": "缩短注册流程并验证效果。",
        "concepts": [
            {"label": "问题", "terms": ["步骤过多"]},
            {"label": "影响", "terms": ["用户退出"]},
            {"label": "行动", "terms": ["缩短流程"]},
        ],
    },
    "transcript": "用户离开是因为步骤太复杂，所以应该先减少步骤，再观察完成率。",
}


class Response:
    def __init__(self, value):
        self.value = value

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False

    def read(self):
        return json.dumps(self.value, ensure_ascii=False).encode("utf-8")


class SemanticServiceTests(unittest.TestCase):
    def test_request_and_prompt_do_not_expand_concepts(self):
        validated = validate_request(REQUEST)
        prompt = build_prompt(validated)
        self.assertIn("用户离开是因为步骤太复杂", prompt)
        self.assertEqual(len(validated["exercise"]["concepts"]), 3)

    def test_model_evidence_must_be_in_transcript(self):
        validated = validate_request(REQUEST)
        value = {"concepts": [
            {"label": "问题", "status": "matched", "evidence": "原文里的词", "confidence": .9},
            {"label": "影响", "status": "missing", "evidence": "", "confidence": .7},
            {"label": "行动", "status": "missing", "evidence": "", "confidence": .7},
        ]}
        with self.assertRaises(SemanticServiceError) as context:
            normalize_output(value, validated)
        self.assertEqual(context.exception.code, "semantic_output_invalid")

    def test_real_contract_is_parsed_and_returns_safe_metadata(self):
        model_value = {"concepts": [
            {"label": "问题", "status": "matched", "evidence": "步骤太复杂", "confidence": .93},
            {"label": "影响", "status": "matched", "evidence": "用户离开", "confidence": .91},
            {"label": "行动", "status": "matched", "evidence": "减少步骤", "confidence": .94},
        ], "relations": [{"type": "cause", "evidence": "因为步骤太复杂"}]}
        remote = {"choices": [{"message": {"content": json.dumps(model_value, ensure_ascii=False)}}], "usage": {"total_tokens": 88}}
        result = evaluate(
            REQUEST, opener=lambda *_args, **_kwargs: Response(remote), sleeper=lambda *_: None,
            environ={"EXPRESSION_LLM_API_KEY": "test-only", "EXPRESSION_LLM_MODEL": "test-model"},
            clock=iter([1.0, 1.2]).__next__,
        )
        self.assertEqual(result["concepts"][0]["status"], "matched")
        self.assertEqual(result["_meta"]["model"], "test-model")
        self.assertNotIn("test-only", json.dumps(result))

    def test_missing_key_fails_closed(self):
        with self.assertRaises(SemanticServiceError) as context:
            evaluate(REQUEST, environ={})
        self.assertEqual(context.exception.code, "semantic_model_unavailable")


if __name__ == "__main__":
    unittest.main()

