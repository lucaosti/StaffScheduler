/**
 * ESLint 9 flat configuration (replaces the legacy `eslintConfig` block in
 * package.json). Rule set is unchanged: react + react-hooks + typescript-eslint
 * recommended presets with the project's existing overrides.
 */

const tsParser = require('@typescript-eslint/parser');
const tsPlugin = require('@typescript-eslint/eslint-plugin');
const react = require('eslint-plugin-react');
const reactHooks = require('eslint-plugin-react-hooks');
const i18next = require('eslint-plugin-i18next');

/*
 * Files enforced to route all user-facing JSX text/attributes through
 * `t()` (react-i18next).
 *
 * WHY AN INCLUDE LIST INSTEAD OF A CODEBASE-WIDE RULE WITH EXCLUDES. Most
 * pages are not converted yet (tracked in a follow-up issue) and still have
 * plenty of legitimate hardcoded English JSX text. Turning the rule on
 * everywhere would need an exclude list nearly as long as the page tree,
 * and that list would need updating every time an unrelated page changed —
 * exactly the "wall of false positives" the project wants to avoid. An
 * include list only grows when a page is actually migrated to
 * `useTranslation()`, which is the one event that should turn the rule on
 * for it. Add a file's path here in the same PR that converts it.
 */
const I18N_ENFORCED_FILES = [
  'src/i18n/**/*.{ts,tsx}',
  'src/components/LocaleSwitcher.tsx',
  'src/pages/Auth/Login.tsx',
  'src/pages/Dashboard/Dashboard.tsx',
  'src/pages/Kiosk/Kiosk.tsx',
  'src/pages/Assignments/MyAssignments.tsx',
  'src/pages/Assignments/ShiftAssignmentPanel.tsx',
  'src/pages/Timeline/Timeline.tsx',
  'src/pages/OnCall/OnCall.tsx',
  'src/pages/TimeOff/TimeOff.tsx',
  'src/pages/Attendance/Attendance.tsx',
  'src/pages/orgManagement/OrgTree.tsx',
  'src/pages/orgManagement/MemberList.tsx',
  'src/pages/Policies/Policies.tsx',
  'src/pages/Policies/PolicyList.tsx',
  'src/pages/Policies/ExceptionList.tsx',
  'src/pages/Directory/Directory.tsx',
  'src/pages/Reports/Reports.tsx',
  'src/pages/OrgChart/OrgChart.tsx',
  'src/pages/Delegations/Delegations.tsx',
  'src/pages/ChangeRequests/ChangeRequests.tsx',
  'src/pages/Approvals/PendingApprovals.tsx',
];

module.exports = [
  {
    ignores: ['build/**', 'node_modules/**', 'coverage/**', 'playwright-report/**', 'test-results/**'],
  },
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaFeatures: { jsx: true },
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
    },
    settings: {
      react: { version: 'detect' },
    },
    plugins: {
      react,
      'react-hooks': reactHooks,
      '@typescript-eslint': tsPlugin,
    },
    rules: {
      ...react.configs.recommended.rules,
      ...react.configs['jsx-runtime'].rules,
      ...reactHooks.configs.recommended.rules,
      ...tsPlugin.configs.recommended.rules,
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-empty-object-type': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          vars: 'all',
          args: 'after-used',
          caughtErrors: 'none',
          ignoreRestSiblings: true,
        },
      ],
      'react/no-unescaped-entities': 'off',
    },
  },
  {
    files: I18N_ENFORCED_FILES,
    // Test files legitimately assert on English strings (getByText('...'))
    // and aren't user-facing UI, so they're never in scope for this rule.
    ignores: ['**/*.test.{ts,tsx}'],
    plugins: {
      i18next,
    },
    rules: {
      'i18next/no-literal-string': [
        'error',
        {
          // 'jsx-only' checks both JSX text nodes and JSX attribute string
          // values (the project default 'jsx-text-only' would skip
          // attributes like `title`/`aria-label` entirely).
          mode: 'jsx-only',
          words: {
            // Same shallow-merge caveat as `jsx-attributes` below: the
            // plugin's own defaults (punctuation-only strings, ALL_CAPS
            // constants, emoji — HTML entities deliberately dropped rather
            // than reaching into the plugin's internal module path) are
            // repeated here so they aren't lost, plus CSS custom properties
            // and bare numeric/unit tokens, which also aren't user-facing
            // copy. Patterns are auto-anchored (`^...$`) by the plugin, so
            // these match the whole string, not a substring.
            exclude: [
              '[0-9!-/:-@[-`{-~]+',
              '[A-Z_-]+',
              /^\p{Emoji}+$/u,
              '--[\\w-]+',
              '[\\d.]+(px|rem|em|%|vh|vw)?',
            ],
          },
          'jsx-attributes': {
            // The plugin merges this whole `jsx-attributes` object over its
            // defaults (a shallow spread), so its own default excludes
            // (className, styleName, style, type, key, id, width, height)
            // must be repeated here explicitly or they're lost. Added on
            // top: react-router's `to` (a route path, not prose, and not
            // covered by the plugin's separate built-in skip for native-DOM
            // -tag attributes because `Link` is a component, not a DOM tag),
            // `ExportCsvLink`'s `path` (an API route, same reasoning as
            // `to`), `EmptyState`'s `icon` (a Bootstrap Icons class name, not
            // prose), and Bootstrap's `data-bs-*` hooks.
            exclude: [
              'className',
              'styleName',
              'style',
              'type',
              'key',
              'id',
              'width',
              'height',
              'to',
              'path',
              'icon',
              'data-bs-.*',
            ],
          },
        },
      ],
    },
  },
];
