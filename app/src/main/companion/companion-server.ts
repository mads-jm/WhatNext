/**
 * Companion Server
 *
 * Lightweight HTTP + WebSocket server running in the Electron main process.
 * Serves a mobile web UI and pushes real-time session state to phone browsers.
 */

import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { WebSocketServer, WebSocket } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import {
    type CompanionClient,
    type CompanionSessionSnapshot,
    type CompanionPlaybackState,
    type CompanionTrack,
    type CompanionParticipant,
    type CompanionTurnState,
    type ServerToPhoneMessage,
    type PhoneToServerMessage,
    serializeMessage,
    serializeHostEnvelope,
    parseRelayEnvelope,
    parsePhoneMessage,
    parsePhoneMessageValue,
} from './companion-protocol';

// ========================================
// Types
// ========================================

export interface CompanionServerInfo {
    port: number;
    localIp: string;
    connectedClients: number;
}

export interface CompanionServerCallbacks {
    onClientJoined?: (client: CompanionClient) => void;
    onClientLeft?: (client: CompanionClient) => void;
    onReaction?: (clientId: string, displayName: string, emoji: string, trackId: string | null) => void;
    onTimeRequest?: (clientId: string, displayName: string, trackId: string | null) => void;
}

interface TrackedClient extends CompanionClient {
    /** LAN clients hold their own socket; relay-tunnelled phones have none. */
    ws: WebSocket | null;
    /** Relay-assigned phone id, set only for phones reached through the tunnel. */
    relayPhoneId?: string;
}

// ========================================
// State
// ========================================

let httpServer: http.Server | null = null;
let wss: WebSocketServer | null = null;
let heartbeatInterval: ReturnType<typeof setInterval> | null = null;

const clients = new Map<string, TrackedClient>();
let callbacks: CompanionServerCallbacks = {};

/** Last-known session snapshot for serving to newly connected clients */
let cachedSnapshot: CompanionSessionSnapshot | null = null;

// ========================================
// Local IP Detection
// ========================================

function getLocalIp(): string {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name] ?? []) {
            if (iface.family === 'IPv4' && !iface.internal) {
                return iface.address;
            }
        }
    }
    return '127.0.0.1';
}

// ========================================
// Static File Serving
// ========================================

const MIME_TYPES: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
};

function resolveCompanionWebDir(): string {
    // __dirname in dev = app/dist/ (tsup output)
    // In dev: app/dist/../src/companion-web → app/src/companion-web
    const devPath = path.resolve(__dirname, '..', 'src', 'companion-web');
    if (fs.existsSync(devPath)) return devPath;

    // In prod: resources/companion-web (packaged alongside asar)
    const prodPath = path.resolve(process.resourcesPath ?? __dirname, 'companion-web');
    if (fs.existsSync(prodPath)) return prodPath;

    // Fallback: sibling to dist
    const distRelative = path.resolve(__dirname, '..', 'companion-web');
    return distRelative;
}

function serveStaticFile(req: http.IncomingMessage, res: http.ServerResponse): void {
    const webDir = resolveCompanionWebDir();
    let filePath = req.url === '/' || req.url === '/session' ? '/index.html' : req.url ?? '/index.html';

    // Strip query params
    filePath = filePath.split('?')[0];

    const fullPath = path.join(webDir, filePath);

    // Security: prevent path traversal (normalize and ensure within webDir)
    const normalizedFull = path.resolve(fullPath);
    const normalizedDir = path.resolve(webDir) + path.sep;
    if (!normalizedFull.startsWith(normalizedDir) && normalizedFull !== normalizedDir.slice(0, -1)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
    }

    fs.readFile(normalizedFull, (err, data) => {
        if (err) {
            res.writeHead(404);
            res.end('Not Found');
            return;
        }

        const ext = path.extname(normalizedFull).toLowerCase();
        const contentType = MIME_TYPES[ext] ?? 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(data);
    });
}

// ========================================
// WebSocket Handling
// ========================================

function handleConnection(ws: WebSocket): void {
    const clientId = uuidv4();

    ws.on('message', (raw: Buffer | string) => {
        const msg = parsePhoneMessage(typeof raw === 'string' ? raw : raw.toString('utf-8'));
        if (!msg) return;

        switch (msg.type) {
            case 'join': {
                // Check for reconnecting client with same displayName.
                // Only LAN clients (those holding a socket) are adoptable — a
                // relay-tunnelled phone with the same name is a different device.
                const existing = Array.from(clients.values()).find(
                    c => c.displayName === msg.displayName
                        && c.ws !== null
                        && c.ws.readyState !== WebSocket.OPEN
                );

                const client: TrackedClient = {
                    id: existing?.id ?? clientId,
                    displayName: msg.displayName,
                    lastHeartbeat: Date.now(),
                    status: 'active',
                    ws,
                };

                if (existing) {
                    clients.delete(existing.id);
                }
                clients.set(client.id, client);

                callbacks.onClientJoined?.({
                    id: client.id,
                    displayName: client.displayName,
                    lastHeartbeat: client.lastHeartbeat,
                    status: client.status,
                });

                // Determine if this client is the host
                const isHost = cachedSnapshot?.participants.some(
                    p => p.isHost && p.displayName.toLowerCase() === msg.displayName.toLowerCase()
                ) ?? false;

                // Acknowledge join with host status
                send(ws, { type: 'join:ack', data: { isHost } });

                // Send current snapshot to new client
                if (cachedSnapshot) {
                    send(ws, { type: 'session:snapshot', data: cachedSnapshot });
                }
                break;
            }

            case 'reaction': {
                const client = findClientByWs(ws);
                if (!client) return;
                client.lastHeartbeat = Date.now();

                callbacks.onReaction?.(client.id, client.displayName, msg.emoji, msg.trackId);

                // Broadcast to all other clients
                broadcast({
                    type: 'reaction:broadcast',
                    data: {
                        clientId: client.id,
                        displayName: client.displayName,
                        emoji: msg.emoji,
                        trackId: msg.trackId,
                    },
                });
                break;
            }

            case 'time-request': {
                const client = findClientByWs(ws);
                if (!client) return;
                client.lastHeartbeat = Date.now();

                callbacks.onTimeRequest?.(client.id, client.displayName, msg.trackId);
                break;
            }

            case 'heartbeat': {
                const client = findClientByWs(ws);
                if (client) {
                    client.lastHeartbeat = Date.now();
                    client.status = 'active';
                }
                break;
            }
        }
    });

    ws.on('close', () => {
        const client = findClientByWs(ws);
        if (client) {
            clients.delete(client.id);
            callbacks.onClientLeft?.({
                id: client.id,
                displayName: client.displayName,
                lastHeartbeat: client.lastHeartbeat,
                status: client.status,
            });
        }
    });

    ws.on('error', (err) => {
        console.error('[Companion] WebSocket error:', err.message);
    });
}

function findClientByWs(ws: WebSocket): TrackedClient | undefined {
    return Array.from(clients.values()).find(c => c.ws === ws);
}

/** Strip the transport fields before handing a client to a callback. */
function toCompanionClient(client: TrackedClient): CompanionClient {
    return {
        id: client.id,
        displayName: client.displayName,
        lastHeartbeat: client.lastHeartbeat,
        status: client.status,
    };
}

function send(ws: WebSocket, msg: ServerToPhoneMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
        ws.send(serializeMessage(msg));
    }
}

/** Send to a single client regardless of whether it is LAN- or relay-attached. */
function sendToClient(client: TrackedClient, msg: ServerToPhoneMessage): void {
    if (client.relayPhoneId) {
        sendToRelay(msg, client.relayPhoneId);
    } else if (client.ws) {
        send(client.ws, msg);
    }
}

function broadcast(msg: ServerToPhoneMessage): void {
    const data = serializeMessage(msg);
    for (const client of clients.values()) {
        // Relay phones have no local socket — they are covered by the single
        // fan-out envelope below, so sending here would double-deliver.
        if (client.ws && client.ws.readyState === WebSocket.OPEN) {
            client.ws.send(data);
        }
    }
    // Also forward to relay tunnel if active (to: null = every relay phone)
    sendToRelay(msg, null);
}

// ========================================
// Heartbeat Monitoring
// ========================================

const HEARTBEAT_INTERVAL_MS = 15_000;
const AWAY_THRESHOLD_MS = HEARTBEAT_INTERVAL_MS * 2;
const REMOVE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

function startHeartbeatMonitor(): void {
    heartbeatInterval = setInterval(() => {
        const now = Date.now();
        for (const [id, client] of clients) {
            const elapsed = now - client.lastHeartbeat;

            if (elapsed > REMOVE_THRESHOLD_MS) {
                clients.delete(id);
                callbacks.onClientLeft?.(toCompanionClient(client));
                if (client.ws && client.ws.readyState === WebSocket.OPEN) {
                    client.ws.close();
                }
            } else if (elapsed > AWAY_THRESHOLD_MS && client.status !== 'away') {
                client.status = 'away';
            }
        }
    }, HEARTBEAT_INTERVAL_MS);
}

// ========================================
// Public API
// ========================================

export function startCompanionServer(
    cbs: CompanionServerCallbacks = {}
): Promise<{ port: number; localIp: string; stop: () => void }> {
    return new Promise((resolve, reject) => {
        if (httpServer) {
            reject(new Error('Companion server already running'));
            return;
        }

        callbacks = cbs;

        httpServer = http.createServer(serveStaticFile);
        wss = new WebSocketServer({ server: httpServer, path: '/ws' });

        wss.on('connection', handleConnection);

        // Listen on port 0 → OS assigns an available port
        httpServer.listen(0, '0.0.0.0', () => {
            const addr = httpServer!.address();
            const port = typeof addr === 'object' && addr ? addr.port : 0;
            const localIp = getLocalIp();

            console.log(`[Companion] Server started on http://${localIp}:${port}`);

            startHeartbeatMonitor();

            resolve({
                port,
                localIp,
                stop: stopCompanionServer,
            });
        });

        httpServer.on('error', (err) => {
            console.error('[Companion] Server error:', err);
            reject(err);
        });
    });
}

export function stopCompanionServer(): void {
    if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
        heartbeatInterval = null;
    }

    // Close all client connections
    for (const client of clients.values()) {
        if (client.ws && client.ws.readyState === WebSocket.OPEN) {
            client.ws.close();
        }
    }
    clients.clear();

    if (wss) {
        wss.close();
        wss = null;
    }

    if (httpServer) {
        httpServer.close();
        httpServer = null;
    }

    // Also stop relay tunnel if active
    stopRelayTunnel();

    callbacks = {};
    cachedSnapshot = null;

    console.log('[Companion] Server stopped');
}

export function getCompanionServerInfo(): CompanionServerInfo | null {
    if (!httpServer) return null;

    const addr = httpServer.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;

    return {
        port,
        localIp: getLocalIp(),
        connectedClients: clients.size,
    };
}

// ========================================
// State Push Methods (called from IPC handlers)
// ========================================

export function pushSessionSnapshot(snapshot: CompanionSessionSnapshot): void {
    cachedSnapshot = snapshot;
    broadcast({ type: 'session:snapshot', data: snapshot });
}

export function pushPlaybackUpdate(playback: CompanionPlaybackState): void {
    if (cachedSnapshot) {
        cachedSnapshot.playback = playback;
    }
    broadcast({ type: 'playback:update', data: playback });
}

export function pushTracksUpdate(tracks: CompanionTrack[]): void {
    if (cachedSnapshot) {
        cachedSnapshot.tracks = tracks;
    }
    broadcast({ type: 'tracks:update', data: { tracks } });
}

export function pushParticipantsUpdate(participants: CompanionParticipant[]): void {
    if (cachedSnapshot) {
        cachedSnapshot.participants = participants;
    }
    broadcast({ type: 'participants:update', data: { participants } });
}

export function pushTurnUpdate(turn: CompanionTurnState): void {
    if (cachedSnapshot) {
        cachedSnapshot.turn = turn;
    }
    broadcast({ type: 'turn:update', data: turn });
}

export function sendTimeRequestAck(clientId: string, status: 'seen' | 'granted'): void {
    const client = clients.get(clientId);
    if (client) {
        // Addressed to one client only — relay phones get a targeted envelope
        // so the other phones on the same tunnel do not see the ack.
        sendToClient(client, { type: 'time-request:ack', data: { status } });
    }
}

export function isCompanionServerRunning(): boolean {
    return httpServer !== null;
}

// ========================================
// Relay Tunnel
// ========================================

let relayWs: WebSocket | null = null;
let relaySessionCode: string | null = null;
let relayBaseUrl: string | null = null;
/** Host credential minted by the relay at session creation. Never leaves this process except as an Authorization header. */
let relayHostToken: string | null = null;
let relayReconnectTimer: ReturnType<typeof setTimeout> | null = null;
let relayReconnectAttempt = 0;

/** Relay close codes that will never succeed on retry — stop the backoff loop. */
const RELAY_FATAL_CLOSE_CODES = new Set([
    4001, // session not found (relay restarted or session expired)
    4003, // unauthorized (host token rejected)
]);

/** Namespaced client id for a relay-tunnelled phone. */
function relayClientId(phoneId: string): string {
    return `relay:${phoneId}`;
}

export interface RelayTunnelInfo {
    sessionCode: string;
    relayUrl: string;
}

/**
 * Open an outbound WebSocket to the relay's companion tunnel.
 * Creates a session on the relay first, then connects as host.
 * Returns the public URL that phone clients should connect to.
 */
export async function startRelayTunnel(relayHost: string): Promise<RelayTunnelInfo> {
    if (relayWs && relayWs.readyState === WebSocket.OPEN) {
        if (relaySessionCode && relayBaseUrl) {
            return { sessionCode: relaySessionCode, relayUrl: `${relayBaseUrl}/s/${relaySessionCode}` };
        }
    }

    // Normalize host — strip trailing slash, ensure http(s)
    const baseUrl = relayHost.replace(/\/+$/, '');

    // 1. Create session on relay
    const resp = await fetch(`${baseUrl}/session`, { method: 'POST' });
    if (!resp.ok) {
        throw new Error(`Relay returned ${resp.status}: ${await resp.text()}`);
    }
    const { code, hostToken } = await resp.json() as { code?: string; hostToken?: string };

    if (typeof code !== 'string' || code.length === 0) {
        throw new Error(`Relay at ${baseUrl} returned no session code.`);
    }

    // Fail closed on version skew: a relay that mints no host credential is
    // older than this app and would accept an unauthenticated tunnel, which
    // anyone holding the public session code could hijack.
    if (typeof hostToken !== 'string' || hostToken.length === 0) {
        throw new Error(
            `Relay at ${baseUrl} did not issue a host credential — it is running an older ` +
            `companion tunnel than this version of WhatNext requires. Update and restart the relay ` +
            `(relay/companion-tunnel.mjs); WhatNext will not open an unauthenticated tunnel.`
        );
    }

    relayBaseUrl = baseUrl;
    relaySessionCode = code;
    relayHostToken = hostToken;

    // 2. Connect as host
    const wsProtocol = baseUrl.startsWith('https') ? 'wss:' : 'ws:';
    const wsHost = baseUrl.replace(/^https?:\/\//, '');
    const wsUrl = `${wsProtocol}//${wsHost}/host/${code}`;

    return new Promise((resolve, reject) => {
        connectRelayWs(wsUrl, () => {
            console.log(`[Companion] Relay tunnel open: session ${code}`);
            relayReconnectAttempt = 0;

            // Send cached snapshot so relay phones get current state
            if (cachedSnapshot) {
                sendToRelay({ type: 'session:snapshot', data: cachedSnapshot }, null);
            }

            resolve({
                sessionCode: code,
                relayUrl: `${baseUrl}/s/${code}`,
            });
        }, reject);
    });
}

function connectRelayWs(
    wsUrl: string,
    onFirstOpen?: () => void,
    onFirstError?: (err: Error) => void
): void {
    // The host credential travels as a request header, never in the URL, so it
    // cannot leak into the phone-facing link, the QR payload, or access logs.
    relayWs = new WebSocket(wsUrl, {
        headers: { Authorization: `Bearer ${relayHostToken ?? ''}` },
    });
    let resolved = false;

    relayWs.onopen = () => {
        console.log('[Companion] Relay WS connected');
        relayReconnectAttempt = 0;

        if (!resolved && onFirstOpen) {
            resolved = true;
            onFirstOpen();
        } else if (cachedSnapshot) {
            // Reconnection — re-send snapshot
            sendToRelay({ type: 'session:snapshot', data: cachedSnapshot }, null);
        }
    };

    relayWs.onmessage = (event: { data: unknown }) => {
        // Relay → host frames are v1 tunnel envelopes. Anything else is a
        // protocol mismatch and is dropped rather than guessed at.
        const raw = typeof event.data === 'string' ? event.data : String(event.data);
        const envelope = parseRelayEnvelope(raw);
        if (!envelope) return;

        if (envelope.type === 'phone:disconnect') {
            handleRelayPhoneDisconnect(envelope.from);
            return;
        }

        const msg = parsePhoneMessageValue(envelope.payload);
        if (msg) handleRelayPhoneMessage(envelope.from, msg);
    };

    relayWs.onclose = (event: { code?: number; reason?: string }) => {
        const code = event?.code;
        console.log(`[Companion] Relay WS closed (code ${code ?? 'unknown'})`);

        if (typeof code === 'number' && RELAY_FATAL_CLOSE_CODES.has(code)) {
            // Retrying cannot help: the relay rejected the credential or the
            // session is gone. Tear down instead of spinning the backoff loop.
            console.error(
                `[Companion] Relay refused the tunnel (code ${code}). ` +
                'The session must be re-created against a matching relay.'
            );
            if (!resolved && onFirstError) {
                resolved = true;
                onFirstError(new Error(
                    code === 4003
                        ? 'Relay rejected the host credential — relay and app builds may not match.'
                        : 'Relay has no such session — it may have restarted or the session expired.'
                ));
            }
            stopRelayTunnel();
            return;
        }

        if (!resolved && onFirstError) {
            resolved = true;
            onFirstError(new Error('Relay closed the tunnel before it was established.'));
            return;
        }

        scheduleRelayReconnect(wsUrl);
    };

    relayWs.onerror = (err: { message?: string }) => {
        console.error('[Companion] Relay WS error:', err.message ?? 'unknown');
        if (!resolved && onFirstError) {
            resolved = true;
            onFirstError(new Error(err.message ?? 'Relay connection failed'));
        }
    };
}

function scheduleRelayReconnect(wsUrl: string): void {
    if (relayReconnectTimer || !relaySessionCode) return;

    const delay = Math.min(1000 * Math.pow(2, relayReconnectAttempt), 15000);
    relayReconnectAttempt++;

    relayReconnectTimer = setTimeout(() => {
        relayReconnectTimer = null;
        if (relaySessionCode) {
            connectRelayWs(wsUrl);
        }
    }, delay);
}

/**
 * Handle a phone message that arrived through the relay tunnel.
 *
 * Relay phones are registered in the same `clients` map as LAN phones, keyed by
 * the relay-assigned phone id, so every per-client path (targeted acks, client
 * counts, leave events) works identically on both transports.
 */
function handleRelayPhoneMessage(phoneId: string, msg: PhoneToServerMessage): void {
    const id = relayClientId(phoneId);

    if (msg.type === 'join') {
        const client: TrackedClient = {
            id,
            displayName: msg.displayName,
            lastHeartbeat: Date.now(),
            status: 'active',
            ws: null,
            relayPhoneId: phoneId,
        };
        clients.set(id, client);
        callbacks.onClientJoined?.(toCompanionClient(client));

        const isHost = cachedSnapshot?.participants.some(
            p => p.isHost && p.displayName.toLowerCase() === msg.displayName.toLowerCase()
        ) ?? false;
        sendToClient(client, { type: 'join:ack', data: { isHost } });

        if (cachedSnapshot) {
            sendToClient(client, { type: 'session:snapshot', data: cachedSnapshot });
        }
        return;
    }

    // Everything else requires a prior join so the sender is attributable.
    const client = clients.get(id);
    if (!client) return;
    client.lastHeartbeat = Date.now();

    switch (msg.type) {
        case 'reaction':
            client.status = 'active';
            callbacks.onReaction?.(client.id, client.displayName, msg.emoji, msg.trackId);
            broadcast({
                type: 'reaction:broadcast',
                data: {
                    clientId: client.id,
                    displayName: client.displayName,
                    emoji: msg.emoji,
                    trackId: msg.trackId,
                },
            });
            break;

        case 'time-request':
            client.status = 'active';
            callbacks.onTimeRequest?.(client.id, client.displayName, msg.trackId);
            break;

        case 'heartbeat':
            client.status = 'active';
            break;
    }
}

function handleRelayPhoneDisconnect(phoneId: string): void {
    const client = clients.get(relayClientId(phoneId));
    if (!client) return;
    clients.delete(client.id);
    callbacks.onClientLeft?.(toCompanionClient(client));
}

/** Drop every relay-tunnelled client, notifying the renderer for each. */
function purgeRelayClients(): void {
    for (const client of Array.from(clients.values())) {
        if (!client.relayPhoneId) continue;
        clients.delete(client.id);
        callbacks.onClientLeft?.(toCompanionClient(client));
    }
}

/** `to === null` fans out to every phone on the tunnel; otherwise one phone. */
function sendToRelay(msg: ServerToPhoneMessage, to: string | null): void {
    if (relayWs && relayWs.readyState === WebSocket.OPEN) {
        relayWs.send(serializeHostEnvelope(to, msg));
    }
}

export function stopRelayTunnel(): void {
    if (relayReconnectTimer) {
        clearTimeout(relayReconnectTimer);
        relayReconnectTimer = null;
    }

    if (relayWs) {
        relayWs.close();
        relayWs = null;
    }

    // Phones reached through the tunnel are unreachable now — drop them so the
    // client count and the roster do not keep ghosts around.
    purgeRelayClients();

    relaySessionCode = null;
    relayBaseUrl = null;
    relayHostToken = null;
    relayReconnectAttempt = 0;

    console.log('[Companion] Relay tunnel closed');
}

export function getRelayTunnelInfo(): RelayTunnelInfo | null {
    if (!relaySessionCode || !relayBaseUrl) return null;
    return {
        sessionCode: relaySessionCode,
        relayUrl: `${relayBaseUrl}/s/${relaySessionCode}`,
    };
}

export function isRelayTunnelActive(): boolean {
    return relayWs !== null && relayWs.readyState === WebSocket.OPEN;
}
