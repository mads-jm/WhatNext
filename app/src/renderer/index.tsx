// Renderer entry for Vite. Keep the renderer sandboxed and talk via preload API.
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from '@renderer/App';

const container = document.getElementById('root');
if (!container) {
    throw new Error('Root container #root not found in index.html');
}

createRoot(container).render(<App />);
