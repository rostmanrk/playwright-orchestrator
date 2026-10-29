import eslint from '@eslint/js';
import { defineConfig } from 'eslint/config';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig(
    {
        ignores: [
            '**/dist/**',
            '**/node_modules/**',
            'test-results/**',
            'playwright-report/**',
            'blob-reports/**',
            'test-runs/**',
            '**/*.tmp.ts',
        ],
    },
    eslint.configs.recommended,
    tseslint.configs.recommended,
    {
        languageOptions: {
            globals: globals.node,
        },
    },
    {
        // Type-aware rules for the published packages
        files: ['packages/*/src/**/*.{ts,cts}'],
        extends: [tseslint.configs.recommendedTypeChecked],
        languageOptions: {
            parserOptions: {
                projectService: true,
                tsconfigRootDir: import.meta.dirname,
            },
        },
        rules: {
            // Values from untyped Playwright internals are `any` by design
            '@typescript-eslint/no-unsafe-assignment': 'off',
            '@typescript-eslint/no-unsafe-member-access': 'off',
            '@typescript-eslint/no-unsafe-return': 'off',
            '@typescript-eslint/no-unsafe-call': 'off',
            '@typescript-eslint/no-unsafe-argument': 'off',
        },
    },
    {
        files: ['scripts/**/*.js'],
        languageOptions: {
            sourceType: 'commonjs',
        },
        rules: {
            '@typescript-eslint/no-require-imports': 'off',
        },
    },
    {
        rules: {
            // `any` is used deliberately to reach into untyped Playwright internals
            '@typescript-eslint/no-explicit-any': 'off',
            '@typescript-eslint/no-unused-vars': [
                'error',
                { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true },
            ],
            '@typescript-eslint/no-unused-expressions': ['error', { allowTernary: true }],
            'no-empty': ['error', { allowEmptyCatch: true }],
        },
    },
    // Formatting is Prettier's job
    prettier,
);
