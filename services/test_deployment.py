import unittest
from deployment_config import validate_deployment


class DeploymentTests(unittest.TestCase):
    def setUp(self):
        self.env = dict(EXPRESSION_ENV='production', EXPRESSION_PUBLIC_ORIGIN='https://training.example.com',
                        EXPRESSION_SECURE_COOKIE='true', EXPRESSION_REQUIRE_BYOK='true',
                        EXPRESSION_ADMIN_TOKEN='test-only-' * 4, EXPRESSION_DATA_DIR='/data')

    def test_local_development_and_valid_production(self):
        self.assertIsNone(validate_deployment({}))
        self.assertEqual(validate_deployment(self.env), 'training.example.com')

    def test_production_fails_closed(self):
        for field, values in {
            'EXPRESSION_PUBLIC_ORIGIN': ['', 'http://training.example.com', 'https://localhost', 'https://build.invalid', 'https://a:b@example.com', 'https://example.com/api'],
            'EXPRESSION_SECURE_COOKIE': ['false', '', 'TRUE'], 'EXPRESSION_REQUIRE_BYOK': ['false'],
            'EXPRESSION_ADMIN_TOKEN': ['', 'short'], 'EXPRESSION_DATA_DIR': ['', './temp'],
        }.items():
            for value in values:
                with self.subTest(field=field, value=value), self.assertRaises(ValueError):
                    validate_deployment({**self.env, field: value})
