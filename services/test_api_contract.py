import unittest

from api_contract import error_payload


class ApiContractTests(unittest.TestCase):
    def test_error_payload_has_one_stable_shape(self):
        self.assertEqual(error_payload("invalid_input", "请检查输入。"), {
            "error": {"code": "invalid_input", "message": "请检查输入。", "retryable": False}
        })

    def test_error_payload_keeps_safe_field_errors(self):
        value = error_payload("invalid_input", "请检查输入。", True, {"topic": "不能为空"})
        self.assertEqual(value["error"]["fieldErrors"], {"topic": "不能为空"})
        self.assertTrue(value["error"]["retryable"])


if __name__ == "__main__":
    unittest.main()
