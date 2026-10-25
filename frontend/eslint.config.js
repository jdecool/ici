import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';
import react from 'eslint-plugin-react';
import hooks from 'eslint-plugin-react-hooks';
import a11y from 'eslint-plugin-jsx-a11y';
import { sliceBoundaries } from './eslint/slice-boundaries.js';

export default tseslint.config(
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'coverage/**',
      'reports/**',
      'playwright-report/**',
      'test-results/**',
      '.stryker-tmp/**',
    ],
  },
  js.configs.recommended,
  { files: ['**/*.js'], languageOptions: { globals: globals.node } },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: {
      react,
      'react-hooks': hooks,
      'jsx-a11y': a11y,
      architecture: { rules: { 'slice-boundaries': sliceBoundaries } },
    },
    settings: { react: { version: 'detect' } },
    rules: {
      ...react.configs.recommended.rules,
      ...react.configs['jsx-runtime'].rules,
      ...hooks.configs.recommended.rules,
      ...a11y.flatConfigs.recommended.rules,
      'react/prop-types': 'off',
      '@typescript-eslint/consistent-type-imports': 'error',
      'architecture/slice-boundaries': 'error',
    },
  },
);
