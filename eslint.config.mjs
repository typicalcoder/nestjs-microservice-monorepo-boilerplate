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
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
    },
  },
  // RPC services (anything except gateway/) reach the client through
  // RMQ envelopes — `MicroserviceException` carries status/code/details
  // across the wire, NestJS HttpExceptions do not. Throwing a 4xx
  // HttpException from a worker still works (the RpcAllExceptionsFilter
  // remaps it), but the conversion strips intent and keeps two parallel
  // error vocabularies alive. New code in the workers must use
  // MicroserviceException directly.
  {
    files: [
      'apps/user/**/*.ts',
      'apps/habit/**/*.ts',
      'apps/world/**/*.ts',
      'apps/journal/**/*.ts',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@nestjs/common',
              importNames: [
                'BadRequestException',
                'ConflictException',
                'ForbiddenException',
                'NotFoundException',
                'UnauthorizedException',
              ],
              message:
                'Use MicroserviceException (or its .notFound/.conflict/.badRequest helpers) — HttpExceptions cross the RMQ wire less cleanly.',
            },
          ],
        },
      ],
    },
  },
);