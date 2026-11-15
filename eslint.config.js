import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      'docs/**',
      'assets/**',
      '.claude/**',
      '_setup/**',
      'apps/web/public/**',
      'playwright-report/**',
      'test-results/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
      eqeqeq: ['error', 'always'],
      'no-console': 'off',
    },
  },
  // Pricing and all business rules are server-only (G1): the web app may import contracts only.
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/_shared/domain/**', '**/_shared/domain', '@domain/*'],
              message: 'apps/web must not import _shared/domain (server-only). Use @contracts.',
            },
            {
              group: [
                '**/supabase/functions/api/**',
                '**/_shared/providers/**',
                '**/_shared/db.ts',
              ],
              message: 'apps/web may import only _shared/contracts (via @contracts).',
            },
          ],
        },
      ],
    },
  },
  // Domain code is pure: no I/O or runtime globals, injected Clock only.
  {
    files: ['supabase/functions/_shared/domain/**/*.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'Deno', message: 'Domain code must be runtime-agnostic.' },
        { name: 'process', message: 'Domain code must be runtime-agnostic.' },
        { name: 'fetch', message: 'No I/O in domain code.' },
      ],
      'no-restricted-properties': [
        'error',
        { object: 'Date', property: 'now', message: 'Inject a Clock instead.' },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "NewExpression[callee.name='Date'][arguments.length=0]",
          message: 'Inject a Clock instead of new Date().',
        },
      ],
    },
  },
  // Never log request bodies, coordinates, phones, plates, emails or tokens (conventions §6).
  prettier,
);
