// @ts-check
import eslint from '@eslint/js';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['eslint.config.mjs'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  eslintPluginPrettierRecommended,
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
      sourceType: 'commonjs',
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-floating-promises': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'warn',
      '@typescript-eslint/member-ordering': 'error',
      curly: 'error',
      quotes: [
        'error',
        'single',
        {
          avoidEscape: true,
        },
      ],
      eqeqeq: ['error'],
      'arrow-body-style': ['error'],
      'arrow-parens': ['error', 'as-needed'],
      'require-await': ['error'],
      '@typescript-eslint/explicit-function-return-type': ['error'],
      'import/order': [
        'error',
        {
          groups: ['builtin', 'external', 'internal', 'type'],
        },
      ],
      '@typescript-eslint/no-empty-interface': ['error'],
      '@typescript-eslint/await-thenable': ['error'],
      'no-console': ['error'],
    },
  },
);