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
import { randomBytes, timingSafeEqual } from 'crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import {
    type CompanionClient,
    type JoinDenial,
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
    generateJoinPin,
    normalizeJoinPin,
} from './companion-protocol';

// ========================================
// Types
// ========================================

export interface CompanionServerInfo {
    port: number;
    localIp: string;
    connectedClients: number;
    /** Session-scoped join credential; null only when the server is stopped. */
    joinPin: string | null;
}

export interface CompanionServerCallbacks {
    onClientJoined?: (client: CompanionClient) => void;
    onClientLeft?: (client: CompanionClient) => void;
    onReaction?: (
        clientId: string,
        displayName: string,
        emoji: string,
        trackId: string | null,
    ) => void;
    onTimeRequest?: (
        clientId: string,
        displayName: string,
        trackId: string | null,
    ) => void;
}

interface TrackedClient extends CompanionClient {
    /** LAN clients hold their own socket; relay-tunnelled phones have none. */
    ws: WebSocket | null;
    /** Relay-assigned phone id, set only for phones reached through the tunnel. */
    relayPhoneId?: string;
    /**
     * Per-client secret handed out with `join:ack`. A returning phone recovers
     * this identity by presenting it — display names are not credentials.
     */
    reconnectToken: string;
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
// Participant Credentials
// ========================================

/**
 * The join PIN is minted per companion-server run and covers both transports —
 * a phone on the LAN and a phone on the relay tunnel present the same one.
 * Validation is host-side only: the relay stays a dumb pipe and never learns it.
 */
let joinPin: string | null = null;

/** Brute-force guard: N wrong PINs in a session freeze joins for a minute. */
const MAX_FAILED_JOIN_ATTEMPTS = 10;
const JOIN_LOCKOUT_MS = 60_000;

let failedJoinAttempts = 0;
let joinLockoutUntil = 0;

function secretMatches(presented: string, expected: string): boolean {
    const a = Buffer.from(presented, 'utf-8');
    const b = Buffer.from(expected, 'utf-8');
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
}

/**
 * Decide whether a `join` may proceed. Returns null to allow, or the denial to
 * send back. Counting is session-level (not per client) because a phone gets a
 * fresh transport identity on every reconnect — per-socket counters would be
 * free to reset by reconnecting.
 *
 * `isReturning` is true only when the phone presented a reconnect token that
 * matches a live or recently-retired identity on this transport. Such a phone
 * already cleared the PIN gate once this session, so the lockout must not apply
 * to it: mobile sockets drop and re-open constantly, and any guest can trip the
 * lockout by fat-fingering the PIN — without this exemption one guest's typos
 * would eject every other phone in the session at its next background
 * reconnect. The PIN is still verified; only the session-wide freeze is waived.
 *
 * The exemption is **deliberately unbounded** — a token holder is never frozen
 * out, and no per-identity attempt counter guards it (arbitrated 2026-08-02, do
 * not "fix" this blind). The reason: `join` carries `pin` and `reconnectToken`
 * together in plaintext, so every channel that leaks someone else's token leaks
 * the PIN in the same frame. An attacker who holds a token has no reason to
 * guess the PIN, so bounding the exemption guards a path nobody takes.
 * **Tripwire**: if a token holder is ever allowed to join *without* presenting
 * the PIN, or TLS makes the token no longer co-observable with it, that argument
 * collapses and this needs a per-identity failed-PIN counter. See
 * `companion-client-spec.md` §Security Considerations.
 */
function authorizeJoin(
    presentedPin: string,
    isReturning: boolean,
): JoinDenial | null {
    const now = Date.now();

    if (!isReturning && now < joinLockoutUntil) {
        return { reason: 'locked-out', retryAfterMs: joinLockoutUntil - now };
    }

    if (
        joinPin !== null &&
        secretMatches(normalizeJoinPin(presentedPin), joinPin)
    ) {
        failedJoinAttempts = 0;
        return null;
    }

    failedJoinAttempts++;
    if (failedJoinAttempts >= MAX_FAILED_JOIN_ATTEMPTS) {
        joinLockoutUntil = now + JOIN_LOCKOUT_MS;
        failedJoinAttempts = 0;
        console.warn(
            '[Companion] Join attempts locked out after repeated bad PINs',
        );
        return { reason: 'locked-out', retryAfterMs: JOIN_LOCKOUT_MS };
    }

    return { reason: 'invalid-pin', retryAfterMs: null };
}

function mintReconnectToken(): string {
    return randomBytes(16).toString('hex');
}

/**
 * Find the client a reconnect token belongs to, within one transport.
 *
 * Adoption never crosses transports: a token is bound to the slot it was issued
 * for, so a LAN socket cannot take over a relay-tunnelled phone's identity (or
 * vice versa) even if it somehow learns the token.
 */
function findClientByReconnectToken(
    token: string,
    transport: 'lan' | 'relay',
): TrackedClient | undefined {
    return Array.from(clients.values()).find((c) => {
        const isRelay = c.relayPhoneId !== undefined;
        if (isRelay !== (transport === 'relay')) return false;
        return secretMatches(token, c.reconnectToken);
    });
}

/**
 * Identities of clients that have left, kept just long enough for the phone to
 * come back.
 *
 * A dropped client is removed from `clients` immediately (the desktop roster
 * must not show ghosts), but a suspended phone tab reconnects seconds later and
 * has to be recognisable as the same participant. Holding the identity here for
 * the same window the heartbeat monitor uses keeps both true at once. The token
 * is the only key — a display name never resurrects an identity.
 */
interface RetiredIdentity {
    id: string;
    reconnectToken: string;
    transport: 'lan' | 'relay';
    expiresAt: number;
}

const IDENTITY_GRACE_MS = 5 * 60 * 1000;
/** Bounded so a churning session cannot grow this without limit. */
const MAX_RETIRED_IDENTITIES = 50;

let retiredIdentities: RetiredIdentity[] = [];

function pruneRetiredIdentities(): void {
    const now = Date.now();
    retiredIdentities = retiredIdentities.filter((r) => r.expiresAt > now);
    if (retiredIdentities.length > MAX_RETIRED_IDENTITIES) {
        retiredIdentities = retiredIdentities.slice(-MAX_RETIRED_IDENTITIES);
    }
}

function retireIdentity(client: TrackedClient): void {
    retiredIdentities.push({
        id: client.id,
        reconnectToken: client.reconnectToken,
        transport: client.relayPhoneId !== undefined ? 'relay' : 'lan',
        expiresAt: Date.now() + IDENTITY_GRACE_MS,
    });
    pruneRetiredIdentities();
}

/**
 * Look up a retired identity without consuming it. Separate from the consume
 * step because the lockout exemption has to know whether the token is genuine
 * *before* the join is authorised — a refused join must leave the identity in
 * the holding area for the phone's next attempt.
 */
function findRetiredIdentity(
    token: string,
    transport: 'lan' | 'relay',
): RetiredIdentity | undefined {
    pruneRetiredIdentities();
    return retiredIdentities.find(
        (r) =>
            r.transport === transport && secretMatches(token, r.reconnectToken),
    );
}

/** Take a retired identity out of the holding area (single use). */
function consumeRetiredIdentity(identity: RetiredIdentity): void {
    retiredIdentities = retiredIdentities.filter((r) => r !== identity);
}

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
    const prodPath = path.resolve(
        process.resourcesPath ?? __dirname,
        'companion-web',
    );
    if (fs.existsSync(prodPath)) return prodPath;

    // Fallback: sibling to dist
    const distRelative = path.resolve(__dirname, '..', 'companion-web');
    return distRelative;
}

function serveStaticFile(
    req: http.IncomingMessage,
    res: http.ServerResponse,
): void {
    const webDir = resolveCompanionWebDir();
    let filePath =
        req.url === '/' || req.url === '/session'
            ? '/index.html'
            : (req.url ?? '/index.html');

    // Strip query params
    filePath = filePath.split('?')[0];

    const fullPath = path.join(webDir, filePath);

    // Security: prevent path traversal (normalize and ensure within webDir)
    const normalizedFull = path.resolve(fullPath);
    const normalizedDir = path.resolve(webDir) + path.sep;
    if (
        !normalizedFull.startsWith(normalizedDir) &&
        normalizedFull !== normalizedDir.slice(0, -1)
    ) {
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
        // Never cached: a phone holding a stale companion.js would be refused
        // at join (it sends no PIN) with no way to self-heal. Mirrored in
        // relay/companion-tunnel.mjs, which serves the same files.
        res.writeHead(200, {
            'Content-Type': contentType,
            'Cache-Control': 'no-store',
        });
        res.end(data);
    });
}

// ========================================
// WebSocket Handling
// ========================================

function handleConnection(ws: WebSocket): void {
    const clientId = uuidv4();

    ws.on('message', (raw: Buffer | string) => {
        const msg = parsePhoneMessage(
            typeof raw === 'string' ? raw : raw.toString('utf-8'),
        );
        if (!msg) return;

        switch (msg.type) {
            case 'join': {
                // A returning phone recovers its identity by presenting the
                // token it was issued — never by matching a display name. It
                // may still be in `clients` (socket not yet reaped) or already
                // retired to the grace list. Resolved before authorisation
                // because holding a valid token is what exempts an ordinary
                // reconnect from the lockout.
                const existing = msg.reconnectToken
                    ? findClientByReconnectToken(msg.reconnectToken, 'lan')
                    : undefined;
                const retired =
                    !existing && msg.reconnectToken
                        ? findRetiredIdentity(msg.reconnectToken, 'lan')
                        : undefined;

                const denial = authorizeJoin(
                    msg.pin,
                    Boolean(existing ?? retired),
                );
                if (denial) {
                    // Answer, then leave the socket open: the phone shows the
                    // reason and can retry with a corrected PIN.
                    send(ws, { type: 'join:denied', data: denial });
                    break;
                }

                if (retired) consumeRetiredIdentity(retired);

                if (
                    existing?.ws &&
                    existing.ws !== ws &&
                    existing.ws.readyState === WebSocket.OPEN
                ) {
                    // The previous socket is a zombie the server has not timed
                    // out yet; the token holder takes the identity back.
                    existing.ws.close();
                }

                const client: TrackedClient = {
                    id: existing?.id ?? retired?.id ?? clientId,
                    displayName: msg.displayName,
                    lastHeartbeat: Date.now(),
                    status: 'active',
                    ws,
                    reconnectToken:
                        existing?.reconnectToken ??
                        retired?.reconnectToken ??
                        mintReconnectToken(),
                };

                clients.set(client.id, client);

                callbacks.onClientJoined?.(toCompanionClient(client));

                send(ws, {
                    type: 'join:ack',
                    data: { reconnectToken: client.reconnectToken },
                });

                // Send current snapshot to new client
                if (cachedSnapshot) {
                    send(ws, {
                        type: 'session:snapshot',
                        data: cachedSnapshot,
                    });
                }
                break;
            }

            case 'reaction': {
                const client = findClientByWs(ws);
                if (!client) return;
                client.lastHeartbeat = Date.now();

                callbacks.onReaction?.(
                    client.id,
                    client.displayName,
                    msg.emoji,
                    msg.trackId,
                );

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

                callbacks.onTimeRequest?.(
                    client.id,
                    client.displayName,
                    msg.trackId,
                );
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
        // Looked up by socket: if this identity was already handed to a newer
        // socket (token reconnect), that entry is not this one and survives.
        const client = findClientByWs(ws);
        if (client) {
            clients.delete(client.id);
            retireIdentity(client);
            callbacks.onClientLeft?.(toCompanionClient(client));
        }
    });

    ws.on('error', (err) => {
        console.error('[Companion] WebSocket error:', err.message);
    });
}

function findClientByWs(ws: WebSocket): TrackedClient | undefined {
    return Array.from(clients.values()).find((c) => c.ws === ws);
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
                retireIdentity(client);
                callbacks.onClientLeft?.(toCompanionClient(client));
                if (client.ws && client.ws.readyState === WebSocket.OPEN) {
                    client.ws.close();
                }
            } else if (
                elapsed > AWAY_THRESHOLD_MS &&
                client.status !== 'away'
            ) {
                client.status = 'away';
            }
        }
    }, HEARTBEAT_INTERVAL_MS);
}

// ========================================
// Public API
// ========================================

export function startCompanionServer(
    cbs: CompanionServerCallbacks = {},
): Promise<{
    port: number;
    localIp: string;
    joinPin: string;
    stop: () => void;
}> {
    return new Promise((resolve, reject) => {
        if (httpServer) {
            reject(new Error('Companion server already running'));
            return;
        }

        callbacks = cbs;
        const pin = generateJoinPin();
        joinPin = pin;
        failedJoinAttempts = 0;
        joinLockoutUntil = 0;

        httpServer = http.createServer(serveStaticFile);
        wss = new WebSocketServer({ server: httpServer, path: '/ws' });

        wss.on('connection', handleConnection);

        // Listen on port 0 → OS assigns an available port
        httpServer.listen(0, '0.0.0.0', () => {
            const addr = httpServer!.address();
            const port = typeof addr === 'object' && addr ? addr.port : 0;
            const localIp = getLocalIp();

            console.log(
                `[Companion] Server started on http://${localIp}:${port}`,
            );

            startHeartbeatMonitor();

            resolve({
                port,
                localIp,
                joinPin: pin,
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
    retiredIdentities = [];
    joinPin = null;
    failedJoinAttempts = 0;
    joinLockoutUntil = 0;

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
        joinPin,
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

export function pushParticipantsUpdate(
    participants: CompanionParticipant[],
): void {
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

export function sendTimeRequestAck(
    clientId: string,
    status: 'seen' | 'granted',
): void {
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

/** Namespaced client id for a relay-tunnelled phone, at first join. */
function relayClientId(phoneId: string): string {
    return `relay:${phoneId}`;
}

/**
 * Locate a tunnelled client by the tunnel slot it currently occupies. The map
 * key is the id minted at first join and never changes; `relayPhoneId` moves
 * when the phone reconnects, so routing must key on it and not on the id.
 */
function findClientByRelayPhoneId(phoneId: string): TrackedClient | undefined {
    return Array.from(clients.values()).find((c) => c.relayPhoneId === phoneId);
}

export interface RelayTunnelInfo {
    sessionCode: string;
    /** Phone-facing link, join PIN included as a fragment (see `withPinFragment`). */
    relayUrl: string;
}

/**
 * Append the join PIN as a URL *fragment*.
 *
 * A fragment is never sent to the server, so the PIN stays out of the relay's
 * request log and out of any proxy in between — only the phone's own JS reads
 * it. Scanning the QR therefore stays a one-step join without handing the
 * credential to the (trusted-but-not-omniscient) relay. The LAN link is built
 * the same way in `CompanionSharePanel.tsx`; keep the two in step.
 */
function withPinFragment(url: string): string {
    return joinPin ? `${url}#pin=${joinPin}` : url;
}

/**
 * Open an outbound WebSocket to the relay's companion tunnel.
 * Creates a session on the relay first, then connects as host.
 * Returns the public URL that phone clients should connect to.
 */
export async function startRelayTunnel(
    relayHost: string,
): Promise<RelayTunnelInfo> {
    if (relayWs && relayWs.readyState === WebSocket.OPEN) {
        if (relaySessionCode && relayBaseUrl) {
            return {
                sessionCode: relaySessionCode,
                relayUrl: withPinFragment(
                    `${relayBaseUrl}/s/${relaySessionCode}`,
                ),
            };
        }
    }

    // Normalize host — strip trailing slash, ensure http(s)
    const baseUrl = relayHost.replace(/\/+$/, '');

    // 1. Create session on relay
    const resp = await fetch(`${baseUrl}/session`, { method: 'POST' });
    if (!resp.ok) {
        throw new Error(`Relay returned ${resp.status}: ${await resp.text()}`);
    }
    const { code, hostToken } = (await resp.json()) as {
        code?: string;
        hostToken?: string;
    };

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
                `(relay/companion-tunnel.mjs); WhatNext will not open an unauthenticated tunnel.`,
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
        connectRelayWs(
            wsUrl,
            () => {
                console.log(`[Companion] Relay tunnel open: session ${code}`);
                relayReconnectAttempt = 0;

                // Send cached snapshot so relay phones get current state
                if (cachedSnapshot) {
                    sendToRelay(
                        { type: 'session:snapshot', data: cachedSnapshot },
                        null,
                    );
                }

                resolve({
                    sessionCode: code,
                    relayUrl: withPinFragment(`${baseUrl}/s/${code}`),
                });
            },
            reject,
        );
    });
}

function connectRelayWs(
    wsUrl: string,
    onFirstOpen?: () => void,
    onFirstError?: (err: Error) => void,
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
            sendToRelay(
                { type: 'session:snapshot', data: cachedSnapshot },
                null,
            );
        }
    };

    relayWs.onmessage = (event: { data: unknown }) => {
        // Relay → host frames are v1 tunnel envelopes. Anything else is a
        // protocol mismatch and is dropped rather than guessed at.
        const raw =
            typeof event.data === 'string' ? event.data : String(event.data);
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
                    'The session must be re-created against a matching relay.',
            );
            if (!resolved && onFirstError) {
                resolved = true;
                onFirstError(
                    new Error(
                        code === 4003
                            ? 'Relay rejected the host credential — relay and app builds may not match.'
                            : 'Relay has no such session — it may have restarted or the session expired.',
                    ),
                );
            }
            stopRelayTunnel();
            return;
        }

        if (!resolved && onFirstError) {
            resolved = true;
            onFirstError(
                new Error('Relay closed the tunnel before it was established.'),
            );
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
function handleRelayPhoneMessage(
    phoneId: string,
    msg: PhoneToServerMessage,
): void {
    if (msg.type === 'join') {
        // A relay reconnect arrives on a brand-new phone id. With a token the
        // phone reclaims its existing identity and we simply re-point routing
        // at the new tunnel slot; without one it is a new participant. Resolved
        // before authorisation for the same reason as the LAN path: a genuine
        // token exempts the reconnect from the session-wide lockout.
        const existing = msg.reconnectToken
            ? findClientByReconnectToken(msg.reconnectToken, 'relay')
            : undefined;
        const retired =
            !existing && msg.reconnectToken
                ? findRetiredIdentity(msg.reconnectToken, 'relay')
                : undefined;

        const denial = authorizeJoin(msg.pin, Boolean(existing ?? retired));
        if (denial) {
            // Addressed to the one phone that asked — the relay is a pipe and
            // the other phones on this tunnel must not see the refusal.
            sendToRelay({ type: 'join:denied', data: denial }, phoneId);
            return;
        }

        if (retired) consumeRetiredIdentity(retired);

        let client: TrackedClient;
        if (existing) {
            existing.relayPhoneId = phoneId;
            existing.displayName = msg.displayName;
            existing.lastHeartbeat = Date.now();
            existing.status = 'active';
            client = existing;
        } else {
            client = {
                id: retired?.id ?? relayClientId(phoneId),
                displayName: msg.displayName,
                lastHeartbeat: Date.now(),
                status: 'active',
                ws: null,
                relayPhoneId: phoneId,
                reconnectToken: retired?.reconnectToken ?? mintReconnectToken(),
            };
            clients.set(client.id, client);
        }

        callbacks.onClientJoined?.(toCompanionClient(client));

        sendToClient(client, {
            type: 'join:ack',
            data: { reconnectToken: client.reconnectToken },
        });

        if (cachedSnapshot) {
            sendToClient(client, {
                type: 'session:snapshot',
                data: cachedSnapshot,
            });
        }
        return;
    }

    // Everything else requires a prior join so the sender is attributable.
    const client = findClientByRelayPhoneId(phoneId);
    if (!client) return;
    client.lastHeartbeat = Date.now();

    switch (msg.type) {
        case 'reaction':
            client.status = 'active';
            callbacks.onReaction?.(
                client.id,
                client.displayName,
                msg.emoji,
                msg.trackId,
            );
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
            callbacks.onTimeRequest?.(
                client.id,
                client.displayName,
                msg.trackId,
            );
            break;

        case 'heartbeat':
            client.status = 'active';
            break;
    }
}

function handleRelayPhoneDisconnect(phoneId: string): void {
    // Looked up by the *current* tunnel slot: if this phone already reconnected
    // and reclaimed its identity under a new phone id, the late disconnect for
    // the old slot matches nothing and correctly drops no one.
    const client = findClientByRelayPhoneId(phoneId);
    if (!client) return;
    clients.delete(client.id);
    retireIdentity(client);
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
        relayUrl: withPinFragment(`${relayBaseUrl}/s/${relaySessionCode}`),
    };
}

export function isRelayTunnelActive(): boolean {
    return relayWs !== null && relayWs.readyState === WebSocket.OPEN;
}
