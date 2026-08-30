import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['dist/**', 'web/frontend-foundation.js', 'node_modules/**'] },
  js.configs.recommended,
  {
    files: ['web/*.js'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'script', globals: { ...globals.browser, ...globals.node } },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
      'no-constant-condition': ['error', { checkLoops: false }],
      'no-empty': ['error', { allowEmptyCatch: true }]
    }
  },
  {
    files: ['web/knowledge-studio.js'],
    languageOptions: { globals: { KnowledgeBuilder: 'readonly', TrainingCard: 'readonly' } }
  },
  {
    files: ['scripts/*.mjs', 'e2e/*.mjs'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'module', globals: { ...globals.node, ...globals.browser } }
  }
];
