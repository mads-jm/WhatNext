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
        const parsed = JSON.parse(raw);
        if (typeof parsed !== 'object' || parsed === null || typeof parsed.type !== 'string') {
            return null;
        }

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
    } catch {
        return null;
    }
}
