/**
 * Companion Client WebSocket Protocol
 *
 * Message contracts between the Electron main process (WebSocket server)
 * and phone browser clients (WebSocket clients).
 */

// ========================================
// Server → Phone Messages
// ========================================

export interface CompanionPlaybackState {
    isPlaying: boolean;
    trackId: string | null;
    progressMs: number;
    durationMs: number;
    title: string | null;
    artists: string[];
    albumArtUrl: string | null;
}

export interface CompanionTrack {
    id: string;
    title: string;
    artists: string[];
    album: string;
    durationMs: number;
    albumArtUrl: string | null;
    addedBy: string | null;
}

export interface CompanionParticipant {
    id: string;
    displayName: string;
    avatarUrl: string | null;
    isHost: boolean;
    isCoHost: boolean;
}

export interface CompanionTurnState {
    currentTurn: number | null;
    effectiveTurnIndex: number | null;
    mode: string | null;
}

export interface CompanionSessionSnapshot {
    sessionName: string;
    playback: CompanionPlaybackState;
    tracks: CompanionTrack[];
    participants: CompanionParticipant[];
    turn: CompanionTurnState;
}

/** Discriminated union for all server → phone messages */
export type ServerToPhoneMessage =
    | { type: 'session:snapshot'; data: CompanionSessionSnapshot }
    | { type: 'playback:update'; data: CompanionPlaybackState }
    | { type: 'tracks:update'; data: { tracks: CompanionTrack[] } }
    | { type: 'participants:update'; data: { participants: CompanionParticipant[] } }
    | { type: 'turn:update'; data: CompanionTurnState }
    | { type: 'reaction:broadcast'; data: { clientId: string; displayName: string; emoji: string; trackId: string | null } }
    | { type: 'time-request:ack'; data: { status: 'seen' | 'granted' } }
    | { type: 'join:ack'; data: { isHost: boolean } };

// ========================================
// Phone → Server Messages
// ========================================

export type PhoneToServerMessage =
    | { type: 'join'; displayName: string }
    | { type: 'reaction'; emoji: string; trackId: string | null }
    | { type: 'time-request'; trackId: string | null }
    | { type: 'heartbeat' };

// ========================================
// Host ↔ Relay Tunnel Envelope
// ========================================

/**
 * Wire version for the host↔relay tunnel envelope.
 *
 * The relay (`relay/companion-tunnel.mjs`) hand-mirrors these shapes — it is a
 * separate JS package and cannot import this module. Keep both sides in sync.
 *
 * v1 introduced two things at once: the host must authenticate with the token
 * minted by `POST /session`, and every host↔relay frame is wrapped so single
 * phones can be addressed individually. There is no v0 fallback (fail closed).
 */
export const TUNNEL_PROTOCOL_VERSION = 1;

/** Host (Electron) → relay. `to === null` means "fan out to every phone". */
export interface HostToRelayEnvelope {
    v: number;
    type: 'host:message';
    to: string | null;
    payload: ServerToPhoneMessage;
}

/** Relay → host (Electron). `from` is the relay-assigned phone id. */
export type RelayToHostEnvelope =
    | { v: number; type: 'phone:message'; from: string; payload: unknown }
    | { v: number; type: 'phone:disconnect'; from: string };

export function serializeHostEnvelope(to: string | null, payload: ServerToPhoneMessage): string {
    const envelope: HostToRelayEnvelope = {
        v: TUNNEL_PROTOCOL_VERSION,
        type: 'host:message',
        to,
        payload,
    };
    return JSON.stringify(envelope);
}

/** Parse a relay → host frame. Returns null for anything that is not a v1 envelope. */
export function parseRelayEnvelope(raw: string): RelayToHostEnvelope | null {
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return null;
    }

    if (typeof parsed !== 'object' || parsed === null) return null;
    const candidate = parsed as Record<string, unknown>;

    if (candidate.v !== TUNNEL_PROTOCOL_VERSION) return null;
    if (typeof candidate.from !== 'string' || candidate.from.length === 0) return null;

    if (candidate.type === 'phone:message') {
        return { v: TUNNEL_PROTOCOL_VERSION, type: 'phone:message', from: candidate.from, payload: candidate.payload };
    }
    if (candidate.type === 'phone:disconnect') {
        return { v: TUNNEL_PROTOCOL_VERSION, type: 'phone:disconnect', from: candidate.from };
    }
    return null;
}

// ========================================
// Client Tracking
// ========================================

export interface CompanionClient {
    id: string;
    displayName: string;
    lastHeartbeat: number; // Date.now() ms
    status: 'active' | 'away';
}

// ========================================
// Helpers
// ========================================

export function serializeMessage(msg: ServerToPhoneMessage): string {
    return JSON.stringify(msg);
}

export function parsePhoneMessage(raw: string): PhoneToServerMessage | null {
    try {
        return parsePhoneMessageValue(JSON.parse(raw));
    } catch {
        return null;
    }
}

/**
 * Validate an already-decoded phone message. Relay-tunnelled phone messages
 * arrive pre-parsed inside a tunnel envelope, and must pass exactly the same
 * validation (name trimming, emoji length caps) as LAN clients.
 */
export function parsePhoneMessageValue(value: unknown): PhoneToServerMessage | null {
    if (typeof value !== 'object' || value === null) return null;
    const parsed = value as Record<string, unknown>;
    if (typeof parsed.type !== 'string') return null;

    switch (parsed.type) {
        case 'join':
            if (typeof parsed.displayName !== 'string' || parsed.displayName.trim().length === 0) {
                return null;
            }
            return { type: 'join', displayName: parsed.displayName.trim().slice(0, 30) };

        case 'reaction':
            if (typeof parsed.emoji !== 'string' || parsed.emoji.length === 0 || parsed.emoji.length > 8) {
                return null;
            }
            return {
                type: 'reaction',
                emoji: parsed.emoji,
                trackId: typeof parsed.trackId === 'string' ? parsed.trackId : null,
            };

        case 'time-request':
            return {
                type: 'time-request',
                trackId: typeof parsed.trackId === 'string' ? parsed.trackId : null,
            };

        case 'heartbeat':
            return { type: 'heartbeat' };

        default:
            return null;
    }
}
