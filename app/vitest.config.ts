import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        environment: 'node',
        include: [
            'src/**/__tests__/**/*.test.ts',
            '../service/**/__tests__/**/*.test.ts',
            // The relay is a plain-ESM package with no runner of its own; its
            // tests ride along here (and are .mjs, matching the source).
            '../relay/**/__tests__/**/*.test.mjs',
        ],
        // Use the root tsconfig (covers both main and renderer source).
        // Vitest picks up tsconfig.json by default when no alias config is set.
    },
});
