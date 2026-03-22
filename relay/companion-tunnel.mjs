/**
 * Companion Tunnel
 *
 * Lightweight HTTP + WebSocket server that tunnels companion traffic
 * through the relay for networks where direct LAN access isn't possible.
 *
 * Architecture:
 *   Phone ──WS──► Relay (public) ◄──WS── Electron (outbound)
 *
 * The Electron app opens an outbound WS to /host/<sessionCode>,
 * phone browsers connect to /ws/<sessionCode>. The relay bridges
 * JSON messages between them and serves the companion static files.
 *
 * Environment variables:
 *   COMPANION_PORT - HTTP listen port (default: 4003)
 */

import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { randomBytes } from 'node:crypto';

const COMPANION_PORT = parseInt(process.env.COMPANION_PORT ?? '4003', 10);

// ========================================
// Session Registry
// ========================================

/**
 * Each session has one host (Electron app) and N phone clients.
 * @type {Map<string, { host: WebSocket | null, phones: Map<string, WebSocket> }>}
 */
const sessions = new Map();

const SESSION_CODE_LENGTH = 6;
const SESSION_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours

function generateSessionCode() {
    // 6-char alphanumeric, URL-safe, easy to type
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/0/1
    const bytes = randomBytes(SESSION_CODE_LENGTH);
    let code = '';
    for (let i = 0; i < SESSION_CODE_LENGTH; i++) {
        code += chars[bytes[i] % chars.length];
    }
    return code;
}

function getOrCreateSession(code) {
    if (!sessions.has(code)) {
        sessions.set(code, { host: null, phones: new Map(), createdAt: Date.now() });
    }
    return sessions.get(code);
}

function cleanupSession(code) {
    const session = sessions.get(code);
    if (!session) return;

    // Close all phone connections
    for (const ws of session.phones.values()) {
        if (ws.readyState === WebSocket.OPEN) ws.close();
    }
    session.phones.clear();

    // Only delete if host is also gone
    if (!session.host || session.host.readyState !== WebSocket.OPEN) {
        sessions.delete(code);
        console.log(`[Companion Tunnel] Session ${code} cleaned up`);
    }
}

// Periodic cleanup of stale sessions
setInterval(() => {
    const now = Date.now();
    for (const [code, session] of sessions) {
        if (now - session.createdAt > SESSION_TTL_MS) {
            console.log(`[Companion Tunnel] Session ${code} expired`);
            if (session.host?.readyState === WebSocket.OPEN) session.host.close();
            for (const ws of session.phones.values()) {
                if (ws.readyState === WebSocket.OPEN) ws.close();
            }
            sessions.delete(code);
        }
    }
}, 60_000);

// ========================================
// Static File Serving
// ========================================

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const WEB_DIR = join(__dirname, 'companion-web');

const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
};

function serveStatic(res, filePath) {
    const normalizedFull = resolve(filePath);
    const normalizedDir = resolve(WEB_DIR) + sep;

    if (!normalizedFull.startsWith(normalizedDir) && normalizedFull !== normalizedDir.slice(0, -1)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
    }

    try {
        const data = readFileSync(normalizedFull);
        const ext = extname(normalizedFull).toLowerCase();
        res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] ?? 'application/octet-stream' });
        res.end(data);
    } catch {
        res.writeHead(404);
        res.end('Not Found');
    }
}

// ========================================
// HTTP Server
// ========================================

const httpServer = createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
    const pathname = url.pathname;

    // CORS headers for cross-origin phone access
    res.setHeader('Access-Control-Allow-Origin', '*');

    // POST /session — Electron creates a new tunnel session
    if (req.method === 'POST' && pathname === '/session') {
        let code;
        do {
            code = generateSessionCode();
        } while (sessions.has(code));

        getOrCreateSession(code);
        console.log(`[Companion Tunnel] Session ${code} created`);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ code }));
        return;
    }

    // GET /session/:code/status — check if session exists and host is connected
    const statusMatch = pathname.match(/^\/session\/([A-Z0-9]+)\/status$/);
    if (req.method === 'GET' && statusMatch) {
        const code = statusMatch[1];
        const session = sessions.get(code);
        const exists = !!session;
        const hostConnected = session?.host?.readyState === WebSocket.OPEN;
        const phoneCount = session?.phones.size ?? 0;

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ exists, hostConnected, phoneCount }));
        return;
    }

    // GET /s/:code — serve companion UI for a session
    const sessionPageMatch = pathname.match(/^\/s\/([A-Z0-9]+)\/?$/);
    if (sessionPageMatch) {
        serveStatic(res, join(WEB_DIR, 'index.html'));
        return;
    }

    // Static files
    if (pathname === '/' || pathname === '/index.html') {
        // Root page — minimal landing
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<html><body style="background:#111827;color:#9ca3af;font-family:monospace;display:flex;align-items:center;justify-content:center;height:100vh;margin:0"><p>WhatNext Companion Relay</p></body></html>');
        return;
    }

    // Serve companion static assets (css, js)
    const filePath = join(WEB_DIR, pathname);
    serveStatic(res, filePath);
});

// ========================================
// WebSocket Server
// ========================================

const wss = new WebSocketServer({ server: httpServer });

wss.on('connection', (ws, req) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
    const pathname = url.pathname;

    // Host connection: /host/<sessionCode>
    const hostMatch = pathname.match(/^\/host\/([A-Z0-9]+)$/);
    if (hostMatch) {
        handleHostConnection(ws, hostMatch[1]);
        return;
    }

    // Phone connection: /ws/<sessionCode>
    const phoneMatch = pathname.match(/^\/ws\/([A-Z0-9]+)$/);
    if (phoneMatch) {
        handlePhoneConnection(ws, phoneMatch[1]);
        return;
    }

    // Unknown path — close
    ws.close(4000, 'Invalid path');
});

// ========================================
// Host Connection (Electron → Relay)
// ========================================

function handleHostConnection(ws, code) {
    const session = sessions.get(code);
    if (!session) {
        ws.close(4001, 'Session not found');
        return;
    }

    if (session.host && session.host.readyState === WebSocket.OPEN) {
        // Replace stale host connection
        session.host.close(4002, 'Replaced by new host connection');
    }

    session.host = ws;
    console.log(`[Companion Tunnel] Host connected to session ${code}`);

    ws.on('message', (raw) => {
        // Forward host messages to all phones
        const data = raw.toString('utf-8');
        for (const phone of session.phones.values()) {
            if (phone.readyState === WebSocket.OPEN) {
                phone.send(data);
            }
        }
    });

    ws.on('close', () => {
        console.log(`[Companion Tunnel] Host disconnected from session ${code}`);
        if (session.host === ws) {
            session.host = null;
        }
        // If no phones either, clean up
        if (session.phones.size === 0) {
            cleanupSession(code);
        }
    });

    ws.on('error', (err) => {
        console.error(`[Companion Tunnel] Host WS error (${code}):`, err.message);
    });
}

// ========================================
// Phone Connection (Phone → Relay)
// ========================================

let phoneIdCounter = 0;

function handlePhoneConnection(ws, code) {
    const session = sessions.get(code);
    if (!session) {
        ws.close(4001, 'Session not found');
        return;
    }

    const phoneId = `phone-${++phoneIdCounter}`;
    session.phones.set(phoneId, ws);
    console.log(`[Companion Tunnel] Phone ${phoneId} connected to session ${code} (${session.phones.size} phones)`);

    ws.on('message', (raw) => {
        // Forward phone messages to host
        if (session.host && session.host.readyState === WebSocket.OPEN) {
            session.host.send(raw.toString('utf-8'));
        }
    });

    ws.on('close', () => {
        session.phones.delete(phoneId);
        console.log(`[Companion Tunnel] Phone ${phoneId} disconnected from session ${code} (${session.phones.size} phones)`);
        if (session.phones.size === 0 && (!session.host || session.host.readyState !== WebSocket.OPEN)) {
            cleanupSession(code);
        }
    });

    ws.on('error', (err) => {
        console.error(`[Companion Tunnel] Phone WS error (${code}/${phoneId}):`, err.message);
    });
}

// ========================================
// Start
// ========================================

export function startCompanionTunnel(port = COMPANION_PORT) {
    return new Promise((resolve, reject) => {
        httpServer.listen(port, '0.0.0.0', () => {
            console.log(`[Companion Tunnel] Listening on http://0.0.0.0:${port}`);
            resolve({ port });
        });
        httpServer.on('error', reject);
    });
}

export function stopCompanionTunnel() {
    for (const [code, session] of sessions) {
        if (session.host?.readyState === WebSocket.OPEN) session.host.close();
        for (const ws of session.phones.values()) {
            if (ws.readyState === WebSocket.OPEN) ws.close();
        }
    }
    sessions.clear();
    wss.close();
    httpServer.close();
}
