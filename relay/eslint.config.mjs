import js from '@eslint/js';
import globals from 'globals';
import { defineConfig, globalIgnores } from 'eslint/config';

// Same rule set and same conventions as app/eslint.config.mjs. The leading
// underscore marks a binding that exists to satisfy a signature or a
// destructuring position but is deliberately not read; unprefixed unused
// bindings are still errors.
const noUnusedVars = [
    'error',
    {
        argsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
    },
];

export default defineConfig([
    globalIgnores(['node_modules']),
    {
        // Relay server, companion tunnel and their suites: plain Node ESM.
        files: ['**/*.mjs'],
        ignores: ['companion-web/**'],
        extends: [js.configs.recommended],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'module',
            globals: globals.node,
        },
        rules: {
            'no-unused-vars': noUnusedVars,
        },
    },
    {
        // The phone UI, served to a browser as a classic script — no imports,
        // no exports, no Node globals. This is the linted copy of the pair:
        // app/src/companion-web/ is byte-identical by test
        // (relay/__tests__/companion-web-parity.test.mjs), so gating one gates
        // both, and any fix here has to land there in the same commit.
        files: ['companion-web/**/*.js'],
        extends: [js.configs.recommended],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'script',
            globals: globals.browser,
        },
        rules: {
            'no-unused-vars': noUnusedVars,
        },
    },
]);
