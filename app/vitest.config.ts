import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        environment: 'node',
        include: [
            'src/**/__tests__/**/*.test.ts',
            '../service/**/__tests__/**/*.test.ts',
        ],
        // Use the root tsconfig (covers both main and renderer source).
        // Vitest picks up tsconfig.json by default when no alias config is set.
    },
});
