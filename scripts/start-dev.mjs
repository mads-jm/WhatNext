#!/usr/bin/env node
// Orchestration script to start both WhatNext Electron app and test-peer (cross-platform)

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = dirname(__dirname);
const appDir = join(projectRoot, 'app');
const testPeerDir = join(projectRoot, 'test-peer');

// Colors
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s) => `\x1b[33m${s}\x1b[0m`;
const cyan = (s) => `\x1b[36m${s}\x1b[0m`;
const magenta = (s) => `\x1b[35m${s}\x1b[0m`;

// Parse args
const args = process.argv.slice(2);
let startApp = true;
let startTestPeer = true;

for (const arg of args) {
    if (arg === '--app-only') {
        startTestPeer = false;
    } else if (arg === '--test-peer-only') {
        startApp = false;
    } else if (arg === '--help' || arg === '-h') {
        console.log('Usage: node scripts/start-dev.mjs [OPTIONS]');
        console.log('');
        console.log(
            'Start WhatNext Electron app and/or test-peer for P2P development',
        );
        console.log('');
        console.log('Options:');
        console.log('  --app-only        Start only the Electron app');
        console.log('  --test-peer-only  Start only the test peer');
        console.log('  --help, -h        Show this help message');
        console.log('');
        console.log('Default: Starts both app and test-peer');
        process.exit(0);
    } else {
        console.error(red(`Unknown option: ${arg}`));
        console.error('Use --help for usage information');
        process.exit(1);
    }
}

// Verify directories and dependencies
if (startApp) {
    if (!existsSync(join(appDir, 'package.json'))) {
        console.error(red('Error: Cannot find app/package.json'));
        process.exit(1);
    }
    if (!existsSync(join(appDir, 'node_modules'))) {
        console.error(yellow('App dependencies not installed.'));
        console.error('   Run: cd app && npm install');
        process.exit(1);
    }
}

if (startTestPeer) {
    if (!existsSync(join(testPeerDir, 'package.json'))) {
        console.error(red('Error: Cannot find test-peer/package.json'));
        process.exit(1);
    }
    if (!existsSync(join(testPeerDir, 'node_modules'))) {
        console.error(yellow('Test peer dependencies not installed.'));
        console.error('   Run: cd test-peer && npm install');
        process.exit(1);
    }
}

// Banner
console.log('');
console.log(
    magenta('================================================================'),
);
console.log(magenta('       WhatNext Development Environment Orchestrator'));
console.log(
    magenta('================================================================'),
);
console.log('');

if (startApp) {
    console.log(cyan('  WhatNext Electron App (dev mode)'));
    console.log(cyan('    Vite dev server: http://localhost:1313'));
    console.log(cyan('    Hot reload enabled'));
}
if (startTestPeer) {
    console.log(cyan('  Test Peer (barebones libp2p node)'));
    console.log(cyan('    Auto-discovery via mDNS'));
}

console.log('');
console.log(cyan('Press Ctrl+C to stop all processes'));
console.log('');

// Track child processes for cleanup
const children = [];

function cleanup() {
    console.log('');
    console.log(magenta('Shutting down all processes...'));

    for (const child of children) {
        if (!child.killed) {
            child.kill();
        }
    }

    // Force kill after 3 seconds
    setTimeout(() => {
        for (const child of children) {
            if (!child.killed) {
                child.kill('SIGKILL');
            }
        }
        process.exit(0);
    }, 3000);
}

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);

// Start test-peer as background process with prefixed output
if (startTestPeer) {
    const testPeer = spawn('npm', ['start'], {
        cwd: testPeerDir,
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: true,
    });
    children.push(testPeer);

    const prefix = green('[TEST-PEER] ');

    testPeer.stdout.on('data', (data) => {
        const lines = data.toString().split('\n');
        for (const line of lines) {
            if (line) console.log(`${prefix}${line}`);
        }
    });

    testPeer.stderr.on('data', (data) => {
        const lines = data.toString().split('\n');
        for (const line of lines) {
            if (line) console.error(`${prefix}${line}`);
        }
    });

    testPeer.on('exit', (code) => {
        console.log(yellow(`[TEST-PEER] exited with code ${code}`));
    });
}

// Start app in foreground
if (startApp) {
    const app = spawn('npm', ['run', 'dev'], {
        cwd: appDir,
        stdio: 'inherit',
        shell: true,
    });
    children.push(app);

    app.on('exit', (code) => {
        console.log(yellow(`[APP] exited with code ${code}`));
        cleanup();
    });
} else {
    // If only test-peer, wait for it
    const testPeerProc = children[0];
    if (testPeerProc) {
        testPeerProc.on('exit', () => {
            process.exit(0);
        });
    }
}
