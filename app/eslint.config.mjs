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
