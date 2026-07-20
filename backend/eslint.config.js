/**
 * ESLint 9 flat configuration (replaces the legacy .eslintrc.json).
 * Rule set is unchanged from the eslintrc era: eslint:recommended plus the
 * typescript-eslint parser/plugin and the project's unused-vars conventions.
 */

const js = require('@eslint/js');
const tsParser = require('@typescript-eslint/parser');
const tsPlugin = require('@typescript-eslint/eslint-plugin');
const globals = require('globals');

module.exports = [
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**', '**/*.js'],
  },
  {
    files: ['**/*.ts'],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 2020,
      sourceType: 'module',
      globals: {
        ...globals.node,
        ...globals.es2020,
        ...globals.jest,
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
    },
    rules: {
      ...js.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      'no-unused-vars': 'off',
      'prefer-const': 'error',
      'no-var': 'error',
    },
  },
  {
    // Routes must dispatch on typed AppError subtypes, never on message
    // substrings: the central error middleware owns status-code mapping.
    files: ['src/routes/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "CallExpression[callee.property.name='includes'][callee.object.callee.property.name='toLowerCase']",
          message:
            'Do not map errors by message substring; throw a typed error from src/errors and let the central error middleware set the status.',
        },
        {
          selector:
            "CallExpression[callee.property.name='includes'][callee.object.property.name='message']",
          message:
            'Do not map errors by message substring; throw a typed error from src/errors and let the central error middleware set the status.',
        },
      ],
    },
  },
];
