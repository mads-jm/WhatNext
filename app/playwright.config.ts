import { defineConfig } from '@playwright/test';

export default defineConfig({
    testDir: './e2e/tests',
    timeout: 30000,
    use: {
        // Electron apps connect via the base URL of the Vite dev server in dev mode.
        // For packaged builds, use the custom protocol instead.
        baseURL: 'http://localhost:1313',
    },
    reporter: [['list'], ['html', { open: 'never' }]],
});
