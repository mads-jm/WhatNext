import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        environment: 'node',
        // app's own suites only. relay and service each own a vitest of their
        // own (relay/vitest.config.mjs, service/vitest.config.ts) and each has
        // its own CI job; listing either here would run those suites twice.
        include: ['src/**/__tests__/**/*.test.ts'],
        // Use the root tsconfig (covers both main and renderer source).
        // Vitest picks up tsconfig.json by default when no alias config is set.
    },
});
