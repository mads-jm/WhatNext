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
    serializeMessage,
    parsePhoneMessage,
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
    ws: WebSocket;
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
    // In dev: app/src/companion-web (relative to project root)
    // In prod: resources/companion-web (packaged alongside asar)
    const devPath = path.resolve(__dirname, '..', '..', 'src', 'companion-web');
    if (fs.existsSync(devPath)) return devPath;

    const prodPath = path.resolve(process.resourcesPath ?? __dirname, 'companion-web');
    if (fs.existsSync(prodPath)) return prodPath;

    // Fallback: check relative to dist
    const distRelative = path.resolve(__dirname, '..', 'companion-web');
    return distRelative;
}

function serveStaticFile(req: http.IncomingMessage, res: http.ServerResponse): void {
    const webDir = resolveCompanionWebDir();
    let filePath = req.url === '/' || req.url === '/session' ? '/index.html' : req.url ?? '/index.html';

    // Strip query params
    filePath = filePath.split('?')[0];

    const fullPath = path.join(webDir, filePath);

    // Security: prevent path traversal
    if (!fullPath.startsWith(webDir)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
    }

    fs.readFile(fullPath, (err, data) => {
        if (err) {
            res.writeHead(404);
            res.end('Not Found');
            return;
        }

        const ext = path.extname(fullPath).toLowerCase();
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
                // Check for reconnecting client with same displayName
                const existing = Array.from(clients.values()).find(
                    c => c.displayName === msg.displayName && c.ws.readyState !== WebSocket.OPEN
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

function send(ws: WebSocket, msg: ServerToPhoneMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
        ws.send(serializeMessage(msg));
    }
}

function broadcast(msg: ServerToPhoneMessage): void {
    const data = serializeMessage(msg);
    for (const client of clients.values()) {
        if (client.ws.readyState === WebSocket.OPEN) {
            client.ws.send(data);
        }
    }
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
                callbacks.onClientLeft?.({
                    id: client.id,
                    displayName: client.displayName,
                    lastHeartbeat: client.lastHeartbeat,
                    status: client.status,
                });
                if (client.ws.readyState === WebSocket.OPEN) {
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
        if (client.ws.readyState === WebSocket.OPEN) {
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
        send(client.ws, { type: 'time-request:ack', data: { status } });
    }
}

export function isCompanionServerRunning(): boolean {
    return httpServer !== null;
}
