#!/usr/bin/env node
// Start the helper service (cross-platform)

import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = dirname(__dirname);
const serviceDir = join(projectRoot, 'service');

const port = process.argv[2] || '4200';

const child = spawn('npx', ['ts-node', 'src/server.ts', port], {
    cwd: serviceDir,
    stdio: 'inherit',
    shell: true,
});

child.on('exit', (code) => {
    process.exit(code ?? 0);
});
