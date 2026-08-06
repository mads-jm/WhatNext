import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        environment: 'node',
        // The relay server and companion-tunnel suites. These used to ride
        // along in app's vitest run (app/vitest.config.ts `include`) because
        // relay had no runner; that include is removed in the same commit so
        // nothing runs twice. `.mjs` matches the source — relay is plain ESM
        // JavaScript with no TypeScript.
        include: ['__tests__/**/*.test.mjs'],
    },
});
