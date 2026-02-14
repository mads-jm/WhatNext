#!/usr/bin/env node
// Start the Electron app in development mode (cross-platform)

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = dirname(__dirname);
const appDir = join(projectRoot, 'app');

// Colors
const cyan = (s) => `\x1b[36m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s) => `\x1b[33m${s}\x1b[0m`;

// Verify app directory
if (!existsSync(join(appDir, 'package.json'))) {
    console.error(red('Error: Cannot find app/package.json'));
    console.error(`   Expected path: ${join(appDir, 'package.json')}`);
    process.exit(1);
}

if (!existsSync(join(appDir, 'node_modules'))) {
    console.error(yellow('node_modules not found. Run ./scripts/dev-init.sh first or:'));
    console.error('   cd app && npm install');
    process.exit(1);
}

console.log(cyan('Starting WhatNext in development mode...'));
console.log('   Vite dev server will be on http://localhost:1313');
console.log('   Press Ctrl+C to stop all processes');
console.log('');

const child = spawn('npm', ['run', 'dev'], {
    cwd: appDir,
    stdio: 'inherit',
    shell: true,
});

child.on('exit', (code) => {
    process.exit(code ?? 0);
});
