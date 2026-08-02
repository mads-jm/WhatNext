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
 * Host authentication:
 *   POST /session mints a session code AND a secret host token. The code is
 *   public (it is in the phone URL); the token is not. Only a WebSocket that
 *   presents `Authorization: Bearer <token>` may attach to /host/<code>, so
 *   knowing the code is not enough to hijack a session.
 *
 * Host <-> relay envelope (v1):
 *   host  -> relay: { v, type: 'host:message', to: phoneId|null, payload }
 *   relay -> host:  { v, type: 'phone:message', from: phoneId, payload }
 *                   { v, type: 'phone:disconnect', from: phoneId }
 *   `to: null` fans out to every phone. Phone <-> relay traffic is unwrapped
 *   raw companion JSON — the phone web client is unaware of the envelope.
 *   Mirrored in app/src/main/companion/companion-protocol.ts; keep in sync.
 *
 * Environment variables:
 *   COMPANION_PORT - HTTP listen port (default: 4003)
 */

import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { join, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { randomBytes, timingSafeEqual } from 'node:crypto';

const COMPANION_PORT = parseInt(process.env.COMPANION_PORT ?? '4003', 10);

/** Wire version of the host<->relay envelope. No fallback to unversioned frames. */
const TUNNEL_PROTOCOL_VERSION = 1;

/** 256 bits of host credential — brute-forcing it from the public code is hopeless. */
const HOST_TOKEN_BYTES = 32;

// ========================================
// Session Registry
// ========================================

/**
 * Each session has one host (Electron app) and N phone clients.
 * @type {Map<string, { host: WebSocket | null, hostToken: string, phones: Map<string, WebSocket>, createdAt: number }>}
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

function createSession(code) {
    const session = {
        host: null,
        hostToken: randomBytes(HOST_TOKEN_BYTES).toString('hex'),
        phones: new Map(),
        createdAt: Date.now(),
    };
    sessions.set(code, session);
    return session;
}

/**
 * Constant-time credential comparison. Length is compared first because
 * timingSafeEqual throws on mismatched buffers; the token length is fixed and
 * public, so leaking it tells an attacker nothing.
 */
function tokenMatches(presented, expected) {
    if (typeof presented !== 'string' || typeof expected !== 'string') return false;
    const a = Buffer.from(presented, 'utf-8');
    const b = Buffer.from(expected, 'utf-8');
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
}

/** Extract the host credential from `Authorization: Bearer <token>`. */
function extractHostToken(req) {
    const header = req?.headers?.authorization;
    if (typeof header !== 'string') return null;
    const match = header.match(/^Bearer (.+)$/);
    return match ? match[1] : null;
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
const expiryTimer = setInterval(() => {
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
// Don't hold the process (or a test runner) open just for the sweep.
expiryTimer.unref?.();

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

        const session = createSession(code);
        // The token is returned exactly once, to its creator. Never logged.
        console.log(`[Companion Tunnel] Session ${code} created`);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            code,
            hostToken: session.hostToken,
            tunnelProtocolVersion: TUNNEL_PROTOCOL_VERSION,
        }));
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
        handleHostConnection(ws, hostMatch[1], req);
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

/**
 * Parse a host -> relay frame. Returns null unless it is a well-formed v1
 * envelope, so a version-skewed host is dropped instead of guessed at.
 */
function parseHostEnvelope(raw) {
    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return null;
    }
    if (!parsed || typeof parsed !== 'object') return null;
    if (parsed.v !== TUNNEL_PROTOCOL_VERSION) return null;
    if (parsed.type !== 'host:message') return null;
    if (!parsed.payload || typeof parsed.payload !== 'object') return null;

    const to = typeof parsed.to === 'string' && parsed.to.length > 0 ? parsed.to : null;
    return { to, payload: parsed.payload };
}

/** Send a relay -> host control/message envelope. */
function sendToHost(session, envelope) {
    if (session.host && session.host.readyState === WebSocket.OPEN) {
        session.host.send(JSON.stringify({ v: TUNNEL_PROTOCOL_VERSION, ...envelope }));
    }
}

function handleHostConnection(ws, code, req) {
    const session = sessions.get(code);
    if (!session) {
        ws.close(4001, 'Session not found');
        return;
    }

    // Authenticate BEFORE touching session.host: an unauthenticated attach must
    // not disturb — let alone replace — the host that is already attached.
    if (!tokenMatches(extractHostToken(req), session.hostToken)) {
        console.warn(`[Companion Tunnel] Rejected host attach to session ${code} (bad or missing credential)`);
        ws.close(4003, 'Unauthorized');
        return;
    }

    if (session.host && session.host.readyState === WebSocket.OPEN) {
        // Replace stale host connection
        session.host.close(4002, 'Replaced by new host connection');
    }

    session.host = ws;
    console.log(`[Companion Tunnel] Host connected to session ${code}`);

    ws.on('message', (raw) => {
        const envelope = parseHostEnvelope(raw.toString('utf-8'));
        if (!envelope) {
            // Unversioned or malformed frame — an app older than this relay.
            // Dropped rather than broadcast, so no accidental legacy fallback.
            console.warn(`[Companion Tunnel] Dropped unrecognised host frame for session ${code}`);
            return;
        }

        const data = JSON.stringify(envelope.payload);

        if (envelope.to !== null) {
            // Addressed to one phone (e.g. a time-request ack)
            const phone = session.phones.get(envelope.to);
            if (phone && phone.readyState === WebSocket.OPEN) {
                phone.send(data);
            }
            return;
        }

        // Fan out to every phone
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
        // Forward phone messages to the host, tagged with this phone's id so
        // the host can tell two phones on the same tunnel apart.
        let payload;
        try {
            payload = JSON.parse(raw.toString('utf-8'));
        } catch {
            return;
        }
        if (!payload || typeof payload !== 'object') return;
        sendToHost(session, { type: 'phone:message', from: phoneId, payload });
    });

    ws.on('close', () => {
        session.phones.delete(phoneId);
        console.log(`[Companion Tunnel] Phone ${phoneId} disconnected from session ${code} (${session.phones.size} phones)`);
        sendToHost(session, { type: 'phone:disconnect', from: phoneId });
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
            // Read the bound port back — callers may pass 0 for an OS-assigned one.
            const address = httpServer.address();
            const boundPort = typeof address === 'object' && address ? address.port : port;
            console.log(`[Companion Tunnel] Listening on http://0.0.0.0:${boundPort}`);
            resolve({ port: boundPort });
        });
        httpServer.on('error', reject);
    });
}

export function stopCompanionTunnel() {
    for (const session of sessions.values()) {
        if (session.host?.readyState === WebSocket.OPEN) session.host.close();
        for (const ws of session.phones.values()) {
            if (ws.readyState === WebSocket.OPEN) ws.close();
        }
    }
    sessions.clear();
    clearInterval(expiryTimer);
    wss.close();
    httpServer.close();
}
