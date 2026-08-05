import js from '@eslint/js';
import globals from 'globals';
import { defineConfig, globalIgnores } from 'eslint/config';

// Same rule set and same conventions as app/eslint.config.mjs.
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
        // The whole package is plain Node ESM run straight by `node src/index.js`
        // with no build step (see app/src/shared/lww/index.js for why).
        files: ['**/*.js'],
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
]);
