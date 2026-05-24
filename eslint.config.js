import js from '@eslint/js';
import globals from 'globals';
import react from 'eslint-plugin-react';
import tseslint from 'typescript-eslint';

export default tseslint.config(
    {
        ignores: [
            'dist/',
            'coverage/',
            'node_modules/',
            'eslint.config.js',
            'src/server/v1/**',
        ]
    },
    js.configs.recommended,
    ...tseslint.configs.recommendedTypeChecked,
    {
        languageOptions: {
            ecmaVersion: 2022,
            globals: globals.node,
            parserOptions: {
                ecmaFeatures: {
                    jsx: true
                },
                projectService: true,
                tsconfigRootDir: import.meta.dirname
            }
        },
        plugins: {
            react
        },
        rules: {
            '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'no-type-imports', disallowTypeAnnotations: false }],
            '@typescript-eslint/no-deprecated': 'error',
            '@typescript-eslint/no-floating-promises': 'error',
            '@typescript-eslint/no-unused-vars': [
                'error',
                {
                    argsIgnorePattern: '^_',
                    caughtErrorsIgnorePattern: '^_',
                    varsIgnorePattern: '^_'
                }
            ],
            '@typescript-eslint/only-throw-error': 'off',
            'arrow-body-style': ['error', 'as-needed'],
            'no-duplicate-imports': 'error',
            'no-restricted-imports': ['error', {
                patterns: [{
                    group: ['../../*', '../../**'],
                    message: 'Use @, @client, or @server path aliases instead of multi-level relative imports.'
                }]
            }],
            'func-style': ['error', 'expression', {'allowArrowFunctions': true}],
            'jsx-quotes': ['error', 'prefer-single'],
            'no-restricted-syntax': [
                'error',
                {
                    selector: 'Property[method=true]',
                    message: 'Use a property whose value is an arrow function instead of object method shorthand.'
                }
            ],
            quotes: ['error', 'single', {'avoidEscape': true}],
            'react/jsx-indent-props': ['error', 4],
            semi: ['error', 'always']
        }
    },
    {
        files: ['src/client/**/*.{ts,tsx}', 'tests/**/*.tsx'],
        languageOptions: {
            globals: globals.browser
        }
    }
);
