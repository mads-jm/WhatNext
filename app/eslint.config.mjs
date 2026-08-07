import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';
import { globalIgnores } from 'eslint/config';

export default tseslint.config([
    // Generated output only. These are all gitignored, but ESLint has its own
    // ignore list, so without this the gate's result depends on whether anyone
    // has run `npm run build` / `npm run package` / `npm run test:e2e` locally.
    // (`release/` in particular vendors node_modules, whose .d.ts files are
    // matched by the `**/*.ts` block below.) Same class of build-state
    // dependence that the typecheck gate had before quality-gates cycle 1.
    globalIgnores(['dist', 'release', 'playwright-report', 'test-results']),
    // The phone UI is duplicated verbatim in relay/companion-web/, which
    // relay/eslint.config.mjs lints with browser globals and app's rule set.
    // relay/__tests__/companion-web-parity.test.mjs holds the two byte-identical,
    // so that one gate covers both copies. Without this ignore ESLint still
    // *processes* these files here — matched by no rule block, so no rule runs —
    // and the only thing it can report is that their eslint-disable directives
    // suppress rules this config never enabled.
    globalIgnores(['src/companion-web']),
    {
        files: ['**/*.{ts,tsx}'],
        extends: [
            js.configs.recommended,
            tseslint.configs.recommended,
            reactHooks.configs['recommended-latest'],
            reactRefresh.configs.vite,
        ],
        languageOptions: {
            ecmaVersion: 2020,
            globals: globals.browser,
        },
        rules: {
            // Encode the convention already used throughout the codebase: a leading
            // underscore marks a binding that exists to satisfy a signature or a
            // destructuring position but is deliberately not read (mock handlers
            // matching an IPC signature, ignored tuple slots, swallowed catch
            // bindings). This does not weaken the rule — unprefixed unused bindings
            // are still errors; it just makes the existing convention checkable.
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
