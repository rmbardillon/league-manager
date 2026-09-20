import js from '@eslint/js';
import globals from 'globals';
import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';
import reactHooks from 'eslint-plugin-react-hooks';
import prettier from 'eslint-config-prettier';

export default [
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'web/dist/**',
      'web/node_modules/**',
      'drizzle/**',
      'coverage/**',
    ],
  },
  js.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
    },
    rules: {
      ...tseslint.configs.recommended.rules,
      // TypeScript's own checker handles undefined identifiers; disabling avoids
      // false positives for ambient globals and JSX namespace types.
      'no-undef': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
  {
    // Backend + tooling: Node globals.
    files: ['src/**/*.ts', '*.config.{ts,js}', 'drizzle.config.ts', 'vitest.config.ts'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  {
    // Frontend: browser globals + React Hooks rules.
    files: ['web/**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.browser },
    },
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: {
      // Classic React Hooks rules: enforce the rules of hooks and validate the
      // exhaustive-deps directive so inline disables like the one in useAsync.ts
      // are recognized and the dependency linting actually runs.
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  prettier,
];
