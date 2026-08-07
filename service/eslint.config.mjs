import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import { globalIgnores } from 'eslint/config';

export default tseslint.config([
    // Generated output only. Same build-state independence the app's config
    // buys: without this the gate's result depends on whether anyone has run
    // `tsc` locally.
    globalIgnores(['dist', 'node_modules']),
    {
        files: ['**/*.ts'],
        extends: [js.configs.recommended, tseslint.configs.recommended],
        languageOptions: {
            ecmaVersion: 2020,
            // Node-side throughout: the downloader spawns subprocesses and the
            // server is Express. No browser code in this package.
            globals: globals.node,
        },
        rules: {
            // Identical to app/eslint.config.mjs — see the rationale there.
            '@typescript-eslint/no-unused-vars': [
                'error',
                {
                    argsIgnorePattern: '^_',
                    caughtErrorsIgnorePattern: '^_',
                },
            ],
        },
    },
]);
