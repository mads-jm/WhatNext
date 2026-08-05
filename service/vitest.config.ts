import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        environment: 'node',
        // The downloader suites. These used to ride along in app's vitest run
        // (app/vitest.config.ts `include`) because service had no runner; that
        // include is removed in the same commit so nothing runs twice.
        include: ['downloader/**/__tests__/**/*.test.ts'],
    },
});
