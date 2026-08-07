import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

// Keep this simple per nextspec; use alias to keep imports clean
export default defineConfig({
    // The packaged app loads the built index.html over file:// (see
    // createMainWindow in src/main/main.ts). With the default base of "/",
    // vite emits root-absolute asset refs ("/assets/index-<hash>.js") which
    // file:// resolves against the *filesystem* root, so the window comes up
    // blank. "./" is vite's relative-base shortcut: it only applies to builds —
    // vite resolves it back to "/" for the dev server, so `npm run dev` and the
    // isDev branch of createMainWindow are unaffected.
    base: './',
    plugins: [react(), tailwindcss()],
    resolve: {
        alias: {
            '@renderer': path.resolve(__dirname, 'src/renderer'),
            '@assets': path.resolve(__dirname, '../assets'),
        },
    },
    server: {
        fs: {
            allow: ['..'],
        },
    },
});
