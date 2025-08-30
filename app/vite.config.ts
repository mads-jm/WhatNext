import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// Keep this simple per nextspec; use alias to keep imports clean
export default defineConfig({
    plugins: [react()],
    resolve: {
        alias: {
            '@renderer': path.resolve(__dirname, 'src/renderer'),
        },
    },
});
