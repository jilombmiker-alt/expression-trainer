import json
import unittest

from model_connections import (
    ModelConnectionError,
    ModelConnectionStore,
    build_request,
    parse_text_response,
    provider_catalog,
    validate_settings,
)


class ModelConnectionTests(unittest.TestCase):
    def test_catalog_has_four_allowlisted_providers_without_internal_urls(self):
        catalog = provider_catalog()
        self.assertEqual([item["id"] for item in catalog], ["openai", "deepseek", "anthropic", "gemini"])
        self.assertNotIn("baseUrl", json.dumps(catalog))

    def test_store_never_returns_api_key_and_expires(self):
        now = [1000]
        store = ModelConnectionStore(ttl_seconds=300, clock=lambda: now[0])
        public = store.create("openai", "gpt-4o-mini", "sk-test-secret-value")
        self.assertNotIn("apiKey", public)
        self.assertNotIn("test-secret-value", json.dumps(public))
        self.assertEqual(store.resolve(public["connectionId"])["apiKey"], "sk-test-secret-value")
        now[0] = 1301
        with self.assertRaises(ModelConnectionError) as context:
            store.resolve(public["connectionId"])
        self.assertEqual(context.exception.code, "model_connection_missing")

    def test_delete_revokes_connection(self):
        store = ModelConnectionStore(ttl_seconds=300)
        connection = store.create("deepseek", "deepseek-chat", "sk-test-secret")
        self.assertTrue(store.delete(connection["connectionId"])["disconnected"])
        with self.assertRaises(ModelConnectionError):
            store.inspect(connection["connectionId"])

    def test_unknown_provider_and_unsafe_model_are_rejected(self):
        with self.assertRaises(ModelConnectionError):
            validate_settings("custom", "model", "secret-key")
        with self.assertRaises(ModelConnectionError):
            validate_settings("gemini", "../metadata", "secret-key")

    def test_provider_request_shapes_keep_secrets_in_headers_only(self):
        cases = [
            ("openai", "gpt-4o-mini", "/chat/completions", "Authorization"),
            ("deepseek", "deepseek-chat", "/chat/completions", "Authorization"),
            ("anthropic", "claude-test", "/messages", "X-api-key"),
            ("gemini", "gemini-test", ":generateContent", "X-goog-api-key"),
        ]
        for provider, model, suffix, header in cases:
            with self.subTest(provider=provider):
                settings = validate_settings(provider, model, "secret-test-key")
                request = build_request(settings, "hello", max_tokens=24)
                self.assertIn(suffix, request.full_url)
                self.assertTrue(request.get_header(header))
                self.assertNotIn("secret-test-key", request.data.decode("utf-8"))

    def test_native_provider_responses_are_normalized(self):
        anthropic_text, _, = parse_text_response({"content": [{"type": "text", "text": "{\"ok\":true}"}]}, "anthropic")
        gemini_text, _, = parse_text_response({"candidates": [{"content": {"parts": [{"text": "{\"ok\":true}"}]}}]}, "gemini")
        self.assertEqual(json.loads(anthropic_text), {"ok": True})
        self.assertEqual(json.loads(gemini_text), {"ok": True})


if __name__ == "__main__":
    unittest.main()
