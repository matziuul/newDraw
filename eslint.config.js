import js from '@eslint/js';
import globals from 'globals';

export default [
    // Source files — browser + ESM
    {
        files: ['src/**/*.js'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'module',
            globals: { ...globals.browser },
        },
        rules: {
            ...js.configs.recommended.rules,

            // Correctness
            'eqeqeq':         ['error', 'always'],
            'no-var':          'error',
            'no-implicit-globals': 'error',

            // Style: prefer-const but allow let where reassignment is likely
            'prefer-const':   ['error', { destructuring: 'all' }],

            // Warn on unused vars; allow underscore-prefixed to be silently ignored
            'no-unused-vars': ['warn', { vars: 'all', args: 'after-used', argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],

            // Keep console calls as warnings — some are intentional debug output
            'no-console':     'warn',
        },
    },

    // Test files — Node + browser globals (vitest runs in jsdom)
    {
        files: ['tests/**/*.js'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'module',
            globals: { ...globals.browser, ...globals.node },
        },
        rules: {
            ...js.configs.recommended.rules,
            'no-var':        'error',
            'prefer-const':  ['error', { destructuring: 'all' }],
            'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
            'no-console':    'off',
        },
    },
];
