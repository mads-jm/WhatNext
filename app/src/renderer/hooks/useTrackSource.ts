/**
 * useTrackSource
 * Polling loop for the track source configured for a session.
 * Currently implements the spotify-collab source strategy.
 *
 * Two-phase poll:
 *  1. Lightweight snapshot check (~200 bytes) — skip if nothing changed
 *  2. If total grew, fetch only the new tail; full diff deferred to manual sync
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { getDatabase } from '../db/database';
import {
    bulkAddTracksToPlaylist,
    removeTrackFromPlaylist,
} from '../db/services/playlist-service';
import { bulkImportTracks } from '../db/services/track-service';
import { createSessionParticipant } from '../db/services/user-service';
import {
    addIncomingTrack,
    type AddIncomingTrackResult,
} from '../db/services/track-sink';
import type {
    TrackSourceConfig,
    IncomingTrack,
} from '../../shared/session-interfaces';
import type { SpotifyFullTrackItem } from '../../shared/core/ipc-protocol';

/**
 * Poll cadence for the Spotify arm. Widened from 2 s (30 req/min, straight into
 * Spotify's rate limiter) now that the phase-1 snapshot check makes a no-change
 * poll ~200 bytes and `syncNow` covers "I want it right now".
 */
const POLL_INTERVAL_MS = 12_000;

export interface UseTrackSourceOptions {
    config: TrackSourceConfig;
    playlistId: string;
    enabled: boolean;
    onNewTracks?: (tracks: IncomingTrack[]) => void;
}

/**
 * Imperative add used by local-initiated sources (the Manual arm). Normalizes
 * `incoming`, writes it attributed to `addedBy`, and surfaces it in the feed.
 */
export type AddTrackFn = (
    incoming: IncomingTrack,
    addedBy: string,
) => Promise<AddIncomingTrackResult>;

export interface UseTrackSourceResult {
    syncing: boolean;
    lastSyncAt: string | null;
    error: string | null;
    syncNow: (() => void) | null;
    /** Functional for `type: 'manual'`; null for poll/replication-driven arms. */
    addTrack: AddTrackFn | null;
}

/**
 * Given an array of incoming Spotify tracks, import any that are new to the DB
 * and ensure all are present in the playlist. Returns the incoming tracks that
 * were brand new (for the onNewTracks callback).
 */
async function processIncomingTracks(
    tracks: SpotifyFullTrackItem[],
    playlistId: string,
): Promise<IncomingTrack[]> {
    if (tracks.length === 0) return [];

    const db = await getDatabase();

    // Query only the playlist (already targeted) and tracks matching incoming spotifyIds
    const incomingSpotifyIds = tracks.map((t) => t.spotifyId);
    const [currentPlaylist, matchingLocalTracks] = await Promise.all([
        db.playlists.findOne(playlistId).exec(),
        db.tracks
            .find({ selector: { spotifyId: { $in: incomingSpotifyIds } } })
            .exec(),
    ]);

    const playlistTrackIds = new Set(currentPlaylist?.trackIds ?? []);

    // Index local tracks by spotifyId for O(1) lookup
    const localBySpotifyId = new Map<string, string>();
    for (const t of matchingLocalTracks) {
        if (t.spotifyId) localBySpotifyId.set(t.spotifyId, t.id);
    }

    // Classify incoming tracks
    const existingToAdd: string[] = [];
    const brandNew: SpotifyFullTrackItem[] = [];

    for (const track of tracks) {
        const localId = localBySpotifyId.get(track.spotifyId);
        if (localId) {
            if (!playlistTrackIds.has(localId)) existingToAdd.push(localId);
        } else {
            brandNew.push(track);
        }
    }

    // Only resolve users when there are brand-new tracks that need it
    const spotifyToWhatNext = new Map<string, string>();
    const newCollaboratorIds: string[] = [];

    if (brandNew.length > 0) {
        const uniqueSpotifyUserIds = [
            ...new Set(brandNew.map((t) => t.addedBySpotifyId)),
        ];
        const allUsers = await db.users.find().exec();

        for (const spotifyId of uniqueSpotifyUserIds) {
            const match = allUsers.find((u) =>
                u.linkedAccounts.some(
                    (a) =>
                        a.provider === 'spotify' &&
                        a.providerUserId === spotifyId,
                ),
            );
            if (match) {
                spotifyToWhatNext.set(spotifyId, match.id);
            } else {
                const displayName = brandNew.find(
                    (t) => t.addedBySpotifyId === spotifyId,
                )?.addedByDisplayName;
                const participant = await createSessionParticipant(
                    displayName || spotifyId,
                    spotifyId,
                    displayName,
                );
                spotifyToWhatNext.set(spotifyId, participant.id);
                if (
                    !currentPlaylist?.collaboratorIds.includes(participant.id)
                ) {
                    newCollaboratorIds.push(participant.id);
                }
            }
        }
    }

    // Bulk-insert new tracks + add all to playlist
    let newTrackIds: string[] = [];
    if (brandNew.length > 0) {
        newTrackIds = await bulkImportTracks(
            brandNew.map((t) => ({
                title: t.title,
                artists: t.artists,
                album: t.album,
                durationMs: t.durationMs,
                spotifyId: t.spotifyId,
                addedAt: t.addedAt,
                addedBy: spotifyToWhatNext.get(t.addedBySpotifyId)!,
                albumArtUrl: t.albumArtUrl,
            })),
        );
    }

    const allToAdd = [...existingToAdd, ...newTrackIds];
    if (allToAdd.length > 0) {
        await bulkAddTracksToPlaylist(playlistId, allToAdd);
    }

    // Persist new collaborators in one update
    if (newCollaboratorIds.length > 0 && currentPlaylist) {
        await currentPlaylist.update({
            $set: {
                collaboratorIds: [
                    ...currentPlaylist.collaboratorIds,
                    ...newCollaboratorIds,
                ],
                updatedAt: new Date().toISOString(),
            },
        });
    }

    return brandNew.map((t) => ({
        title: t.title,
        artists: t.artists,
        album: t.album,
        durationMs: t.durationMs,
        externalId: t.spotifyId,
        externalSource: 'spotify',
        albumArtUrl: t.albumArtUrl,
        addedAt: t.addedAt,
        addedByExternalId: t.addedBySpotifyId,
    }));
}

export function useTrackSource(
    options: UseTrackSourceOptions,
): UseTrackSourceResult {
    const { config, playlistId, enabled, onNewTracks } = options;

    const [syncing, setSyncing] = useState(false);
    const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    // Manual-arm state: there is no poll loop, only local-initiated adds.
    const [manualLastAddAt, setManualLastAddAt] = useState<string | null>(null);
    const [manualError, setManualError] = useState<string | null>(null);

    const lastSnapshotIdRef = useRef<string | null>(null);
    const lastTotalRef = useRef<number>(0);
    const pollRef = useRef<(() => Promise<void>) | null>(null);
    const syncingRef = useRef(false);

    useEffect(() => {
        if (!enabled || config.type !== 'spotify-collab') {
            pollRef.current = null;
            return;
        }

        let cancelled = false;

        // Seed lastTotalRef from local playlist so first poll doesn't re-fetch everything
        getDatabase()
            .then((db) => db.playlists.findOne(playlistId).exec())
            .then((pl) => {
                if (pl && lastTotalRef.current === 0) {
                    lastTotalRef.current = pl.trackIds.length;
                }
            });

        const poll = async () => {
            if (cancelled || syncingRef.current) return;

            const spotify = window.electron?.spotify;
            if (!spotify) {
                setError('Spotify IPC not available');
                return;
            }

            syncingRef.current = true;
            setSyncing(true);
            try {
                // ── Phase 1: lightweight snapshot check (~200 bytes) ──────
                const snapshot = await spotify.getPlaylistSnapshot(
                    config.spotifyPlaylistId,
                );

                if (cancelled) return;

                if (!snapshot.success) {
                    setError(snapshot.error ?? 'Failed to check playlist');
                    return;
                }

                const snapshotId = snapshot.snapshotId ?? null;
                const remoteTotal = snapshot.total ?? 0;

                // Nothing changed — skip entirely
                if (snapshotId && snapshotId === lastSnapshotIdRef.current) {
                    setLastSyncAt(new Date().toISOString());
                    return;
                }

                // ── Phase 2: fetch only what's new ────────────────────────
                const localTotal = lastTotalRef.current;

                if (remoteTotal > localTotal) {
                    // Tracks were added — fetch only the tail
                    const result = await spotify.getPlaylistTracksFrom(
                        config.spotifyPlaylistId,
                        localTotal,
                        snapshotId ?? undefined,
                    );

                    if (cancelled) return;

                    if (!result.success) {
                        setError(result.error ?? 'Failed to fetch new tracks');
                        return;
                    }

                    const newTracks = result.tracks ?? [];
                    const newIncoming = await processIncomingTracks(
                        newTracks,
                        playlistId,
                    );

                    if (!cancelled && newIncoming.length > 0) {
                        onNewTracks?.(newIncoming);
                    }
                } else if (remoteTotal < localTotal) {
                    // Tracks were removed — need full sync to find which ones
                    const result = await spotify.getPlaylistTracksFull(
                        config.spotifyPlaylistId,
                    );

                    if (cancelled) return;

                    if (!result.success) {
                        setError(result.error ?? 'Failed to sync playlist');
                        return;
                    }

                    const tracks = result.tracks ?? [];

                    // Process additions (handles re-added tracks too)
                    const newIncoming = await processIncomingTracks(
                        tracks,
                        playlistId,
                    );

                    if (!cancelled && newIncoming.length > 0) {
                        onNewTracks?.(newIncoming);
                    }

                    // Detect removals
                    if (!cancelled) {
                        const db = await getDatabase();
                        const spotifyIdSet = new Set(
                            tracks.map((t) => t.spotifyId),
                        );
                        const playlistDoc = await db.playlists
                            .findOne(playlistId)
                            .exec();
                        if (playlistDoc) {
                            const localTracks = await db.tracks
                                .find({
                                    selector: {
                                        id: { $in: playlistDoc.trackIds },
                                    },
                                })
                                .exec();
                            for (const local of localTracks) {
                                if (cancelled) break;
                                if (
                                    local.spotifyId &&
                                    !spotifyIdSet.has(local.spotifyId)
                                ) {
                                    await removeTrackFromPlaylist(
                                        playlistId,
                                        local.id,
                                    );
                                }
                            }
                        }
                    }
                }
                // else: total same but snapshot changed → reorder only, skip for now

                if (!cancelled) {
                    lastSnapshotIdRef.current = snapshotId;
                    lastTotalRef.current = remoteTotal;
                    setError(null);
                    setLastSyncAt(new Date().toISOString());
                }
            } catch (err) {
                if (!cancelled) {
                    setError(err instanceof Error ? err.message : String(err));
                }
            } finally {
                // Unconditional: `syncingRef` outlives this effect run, so
                // skipping the reset when `cancelled` (unmount, or an `enabled`
                // / playlist change tearing the effect down mid-poll) left the
                // flag stuck `true` and wedged every future poll at the guard
                // above. No poll can be in flight behind us — the guard means
                // only one poll holds the flag at a time — so clearing it here
                // cannot cut short a newer run. `setSyncing` after unmount is a
                // no-op in React 18+.
                setSyncing(false);
                syncingRef.current = false;
            }
        };

        pollRef.current = poll;
        poll();
        const id = setInterval(poll, POLL_INTERVAL_MS);

        return () => {
            cancelled = true;
            pollRef.current = null;
            clearInterval(id);
        };
        // Justification: the dependency list is deliberately narrower than what the
        // rule computes. `poll` closes over `config` and `onNewTracks`, which
        // callers pass as fresh object/function literals each render — including
        // them would tear down and restart the polling interval on every render.
        // That is a behaviour change, not a correctness fix; widening this list
        // safely requires memoising the caller's props first.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [enabled, config.type, playlistId]);

    const syncNow = useCallback(() => {
        pollRef.current?.();
    }, []);

    // Manual arm: local-initiated writes through the shared sink. There is no
    // poll loop — the feed updates from the reactive playlist query once the
    // track lands, and `onNewTracks` mirrors the Spotify arm's emission so feed
    // and turn listeners react identically regardless of source.
    const addTrack = useCallback<AddTrackFn>(
        async (incoming, addedBy) => {
            try {
                const result = await addIncomingTrack(
                    incoming,
                    playlistId,
                    addedBy,
                );
                setManualError(null);
                setManualLastAddAt(new Date().toISOString());
                onNewTracks?.([incoming]);
                return result;
            } catch (err) {
                setManualError(
                    err instanceof Error ? err.message : String(err),
                );
                throw err;
            }
        },
        [playlistId, onNewTracks],
    );

    if (config.type === 'manual') {
        return {
            syncing: false,
            lastSyncAt: manualLastAddAt,
            error: manualError,
            syncNow: null,
            addTrack,
        };
    }

    // P2P arm (#38) is a separate, P2P-gated lane (depends on replication
    // fan-in) — still a no-op here; out of this lane's scope.
    if (config.type === 'p2p') {
        return {
            syncing: false,
            lastSyncAt: null,
            error: null,
            syncNow: null,
            addTrack: null,
        };
    }

    return { syncing, lastSyncAt, error, syncNow, addTrack: null };
}
