/**
 * useCompanionBridge
 * Bridges RxDB session state and playback polling to the companion server
 * via IPC. Activated when a session is active and the companion server is running.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { getDatabase } from '../db/database';
import type { PlaylistDocType, TrackDocType, UserDocType } from '../db/schemas';
import type { PlaybackState } from '../../shared/session-interfaces';
import type {
    CompanionClientEventPayload,
    CompanionReactionPayload,
    CompanionTimeRequestPayload,
} from '../../shared/core/ipc-protocol';
import type {
    CompanionPlaybackState,
    CompanionTrack,
    CompanionParticipant,
    CompanionSessionSnapshot,
    CompanionTurnState,
} from '../../main/companion/companion-protocol';

// ========================================
// Types
// ========================================

export interface CompanionClientInfo {
    clientId: string;
    displayName: string;
}

export interface CompanionReactionEvent {
    clientId: string;
    displayName: string;
    emoji: string;
    trackId: string | null;
    timestamp: number;
}

export interface CompanionTimeRequestEvent {
    clientId: string;
    displayName: string;
    trackId: string | null;
    timestamp: number;
}

interface UseCompanionBridgeParams {
    playlistId: string | null;
    sessionActive: boolean;
    playbackState: PlaybackState | null;
    sessionName?: string;
    hostId?: string;
    coHostIds?: string[];
}

interface UseCompanionBridgeResult {
    serverRunning: boolean;
    serverInfo: { port: number; localIp: string } | null;
    connectedClients: CompanionClientInfo[];
    reactions: CompanionReactionEvent[];
    timeRequests: CompanionTimeRequestEvent[];
    startServer: () => Promise<void>;
    stopServer: () => Promise<void>;
    respondToTimeRequest: (clientId: string, action: 'seen' | 'granted') => void;
    clearReactions: () => void;
    clearTimeRequests: () => void;
}

// ========================================
// Debounce helper
// ========================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function useDebouncedCallback<T extends (...args: any[]) => void>(
    fn: T,
    delayMs: number
): T {
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const fnRef = useRef(fn);
    fnRef.current = fn;

    useEffect(() => {
        return () => {
            if (timer.current) clearTimeout(timer.current);
        };
    }, []);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return useCallback((...args: any[]) => {
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => fnRef.current(...args), delayMs);
    }, [delayMs]) as unknown as T;
}

// ========================================
// Hook
// ========================================

export function useCompanionBridge({
    playlistId,
    sessionActive,
    playbackState,
    sessionName,
    hostId,
    coHostIds = [],
}: UseCompanionBridgeParams): UseCompanionBridgeResult {
    const [serverRunning, setServerRunning] = useState(false);
    const [serverInfo, setServerInfo] = useState<{ port: number; localIp: string } | null>(null);
    const [connectedClients, setConnectedClients] = useState<CompanionClientInfo[]>([]);
    const [reactions, setReactions] = useState<CompanionReactionEvent[]>([]);
    const [timeRequests, setTimeRequests] = useState<CompanionTimeRequestEvent[]>([]);

    const companion = window.electron?.companion;

    // ========================================
    // Server lifecycle
    // ========================================

    const startServer = useCallback(async () => {
        if (!companion || serverRunning) return;
        try {
            const info = await companion.start();
            setServerInfo(info);
            setServerRunning(true);
        } catch (err) {
            console.error('[CompanionBridge] Failed to start server:', err);
        }
    }, [companion, serverRunning]);

    const stopServer = useCallback(async () => {
        if (!companion) return;
        try {
            await companion.stop();
            setServerRunning(false);
            setServerInfo(null);
            setConnectedClients([]);
        } catch (err) {
            console.error('[CompanionBridge] Failed to stop server:', err);
        }
    }, [companion]);

    // ========================================
    // Event listeners
    // ========================================

    useEffect(() => {
        if (!companion || !serverRunning) return;

        const removeJoined = companion.onClientJoined((data: CompanionClientEventPayload) => {
            setConnectedClients((prev) => [
                ...prev.filter((c) => c.clientId !== data.clientId),
                { clientId: data.clientId, displayName: data.displayName },
            ]);
        });

        const removeLeft = companion.onClientLeft((data: CompanionClientEventPayload) => {
            setConnectedClients((prev) => prev.filter((c) => c.clientId !== data.clientId));
        });

        const removeReaction = companion.onReaction((data: CompanionReactionPayload) => {
            setReactions((prev) => [
                ...prev.slice(-49), // Keep last 50
                { ...data, timestamp: Date.now() },
            ]);
        });

        const removeTimeReq = companion.onTimeRequest((data: CompanionTimeRequestPayload) => {
            setTimeRequests((prev) => [
                ...prev.slice(-19), // Keep last 20
                { ...data, timestamp: Date.now() },
            ]);
        });

        return () => {
            removeJoined();
            removeLeft();
            removeReaction();
            removeTimeReq();
        };
    }, [companion, serverRunning]);

    // ========================================
    // Push playback state
    // ========================================

    useEffect(() => {
        if (!companion || !serverRunning || !playbackState) return;

        const mapped: CompanionPlaybackState = {
            isPlaying: playbackState.isPlaying,
            trackId: playbackState.currentTrackExternalId,
            progressMs: playbackState.progressMs,
            durationMs: playbackState.durationMs,
            title: playbackState.trackTitle ?? null,
            artists: playbackState.trackArtists ?? [],
            albumArtUrl: null, // Enriched below if we have track data
        };

        companion.pushPlayback(mapped);
    }, [companion, serverRunning, playbackState]);

    // ========================================
    // Push tracks (debounced)
    // ========================================

    const pushTracks = useDebouncedCallback((tracks: CompanionTrack[]) => {
        companion?.pushTracks(tracks);
    }, 500);

    useEffect(() => {
        if (!companion || !serverRunning || !playlistId || !sessionActive) return;

        let sub: { unsubscribe: () => void } | null = null;
        let alive = true;

        getDatabase().then((db) => {
            if (!alive) return;

            // First get playlist to know track order
            const playlistSub = db.playlists
                .findOne(playlistId)
                .$.subscribe((doc) => {
                    if (!alive || !doc) return;
                    const playlist = doc.toJSON() as PlaylistDocType;
                    const ids = playlist.trackIds;

                    if (ids.length === 0) {
                        pushTracks([]);
                        return;
                    }

                    // Subscribe to tracks
                    sub?.unsubscribe();
                    sub = db.tracks
                        .findByIds(ids)
                        .$.subscribe((trackMap) => {
                            if (!alive) return;
                            const ordered: CompanionTrack[] = ids
                                .map((id) => trackMap.get(id))
                                .filter(Boolean)
                                .map((doc) => {
                                    const t = doc!.toJSON() as TrackDocType;
                                    return {
                                        id: t.id,
                                        title: t.title,
                                        artists: t.artists,
                                        album: t.album,
                                        durationMs: t.durationMs,
                                        albumArtUrl: t.albumArtUrl ?? null,
                                        addedBy: t.addedBy ?? null,
                                    };
                                });
                            pushTracks(ordered);
                        });
                });

            // Store outer sub for cleanup
            sub = playlistSub as unknown as { unsubscribe: () => void };
        });

        return () => {
            alive = false;
            sub?.unsubscribe();
        };
    }, [companion, serverRunning, playlistId, sessionActive]);

    // ========================================
    // Push participants (debounced)
    // ========================================

    const pushParticipants = useDebouncedCallback((participants: CompanionParticipant[]) => {
        companion?.pushParticipants(participants);
    }, 500);

    useEffect(() => {
        if (!companion || !serverRunning || !sessionActive) return;

        let sub: { unsubscribe: () => void } | null = null;
        let alive = true;

        getDatabase().then((db) => {
            if (!alive) return;
            sub = db.users.find().$.subscribe((docs) => {
                if (!alive) return;
                const participants: CompanionParticipant[] = docs.map((doc) => {
                    const u = doc.toJSON() as UserDocType;
                    return {
                        id: u.id,
                        displayName: u.displayName,
                        avatarUrl: u.avatarUrl ?? null,
                        isHost: u.id === hostId,
                        isCoHost: coHostIds.includes(u.id),
                    };
                });
                pushParticipants(participants);
            });
        });

        return () => {
            alive = false;
            sub?.unsubscribe();
        };
    }, [companion, serverRunning, sessionActive, hostId, coHostIds]);

    // ========================================
    // Actions
    // ========================================

    const respondToTimeRequest = useCallback((clientId: string, action: 'seen' | 'granted') => {
        companion?.respondToTimeRequest(clientId, action);
    }, [companion]);

    const clearReactions = useCallback(() => setReactions([]), []);
    const clearTimeRequests = useCallback(() => setTimeRequests([]), []);

    return {
        serverRunning,
        serverInfo,
        connectedClients,
        reactions,
        timeRequests,
        startServer,
        stopServer,
        respondToTimeRequest,
        clearReactions,
        clearTimeRequests,
    };
}
