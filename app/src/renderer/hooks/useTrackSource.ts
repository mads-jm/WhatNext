/**
 * useTrackSource
 * Polling loop for the track source configured for a session.
 * Currently implements the spotify-collab source strategy.
 */

import { useState, useEffect, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../db/database';
import {
    addTrackToPlaylist,
    advanceTurn,
} from '../db/services/playlist-service';
import {
    resolveSpotifyUser,
    createSessionParticipant,
} from '../db/services/user-service';
import type {
    TrackSourceConfig,
    IncomingTrack,
} from '../../shared/session-interfaces';

const POLL_INTERVAL_MS = 5000;

export interface UseTrackSourceOptions {
    config: TrackSourceConfig;
    playlistId: string;
    enabled: boolean;
    onNewTracks?: (tracks: IncomingTrack[]) => void;
}

export interface UseTrackSourceResult {
    syncing: boolean;
    lastSyncAt: string | null;
    error: string | null;
}

export function useTrackSource(options: UseTrackSourceOptions): UseTrackSourceResult {
    const { config, playlistId, enabled, onNewTracks } = options;

    const [syncing, setSyncing] = useState(false);
    const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const lastSnapshotIdRef = useRef<string | null>(null);

    useEffect(() => {
        if (!enabled || config.type !== 'spotify-collab') return;

        let cancelled = false;

        const poll = async () => {
            if (cancelled) return;

            const spotify = window.electron?.spotify;
            if (!spotify) {
                setError('Spotify IPC not available');
                return;
            }

            setSyncing(true);
            try {
                const result = await spotify.getPlaylistTracksFull(
                    config.spotifyPlaylistId
                );

                if (cancelled) return;

                if (!result.success) {
                    setError(result.error ?? 'Failed to fetch playlist tracks');
                    setSyncing(false);
                    return;
                }

                const tracks = result.tracks ?? [];
                const snapshotId = result.snapshotId ?? null;

                // Short-circuit if playlist hasn't changed
                if (snapshotId && snapshotId === lastSnapshotIdRef.current) {
                    setSyncing(false);
                    setLastSyncAt(new Date().toISOString());
                    return;
                }

                lastSnapshotIdRef.current = snapshotId;

                const db = await getDatabase();
                const newIncoming: IncomingTrack[] = [];

                for (const track of tracks) {
                    if (cancelled) break;

                    // Check if we've already imported this Spotify track
                    const existing = await db.tracks
                        .find({ selector: { spotifyId: track.spotifyId } })
                        .exec();

                    if (existing.length > 0) continue;

                    // Map Spotify user → WhatNext user
                    let addedByUserId: string;
                    const resolved = await resolveSpotifyUser(track.addedBySpotifyId);

                    if (resolved) {
                        addedByUserId = resolved.id;
                    } else {
                        const participant = await createSessionParticipant(
                            'Unknown',
                            track.addedBySpotifyId
                        );
                        addedByUserId = participant.id;
                    }

                    const trackId = uuidv4();
                    await db.tracks.insert({
                        id: trackId,
                        title: track.title,
                        artists: track.artists,
                        album: track.album,
                        durationMs: track.durationMs,
                        spotifyId: track.spotifyId,
                        addedAt: track.addedAt,
                        addedBy: addedByUserId,
                    });

                    await addTrackToPlaylist(playlistId, trackId);

                    // Auto-advance turn if the adder matches the current turn holder
                    const playlist = await db.playlists.findOne(playlistId).exec();
                    if (
                        playlist?.queueMode === 'turn_taking' &&
                        playlist.currentTurnUserId === addedByUserId
                    ) {
                        await advanceTurn(playlistId);
                    }

                    newIncoming.push({
                        title: track.title,
                        artists: track.artists,
                        album: track.album,
                        durationMs: track.durationMs,
                        externalId: track.spotifyId,
                        externalSource: 'spotify',
                        albumArtUrl: track.albumArtUrl,
                        addedAt: track.addedAt,
                        addedByExternalId: track.addedBySpotifyId,
                    });
                }

                if (!cancelled && newIncoming.length > 0) {
                    onNewTracks?.(newIncoming);
                }

                if (!cancelled) {
                    setError(null);
                    setLastSyncAt(new Date().toISOString());
                }
            } catch (err) {
                if (!cancelled) {
                    setError(err instanceof Error ? err.message : String(err));
                }
            } finally {
                if (!cancelled) setSyncing(false);
            }
        };

        poll();
        const id = setInterval(poll, POLL_INTERVAL_MS);

        return () => {
            cancelled = true;
            clearInterval(id);
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [enabled, config.type, playlistId]);

    if (config.type === 'manual' || config.type === 'p2p') {
        return { syncing: false, lastSyncAt: null, error: null };
    }

    return { syncing, lastSyncAt, error };
}
