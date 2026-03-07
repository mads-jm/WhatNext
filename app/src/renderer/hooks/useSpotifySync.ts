/**
 * useSpotifySync — sync a Spotify-linked playlist against the live Spotify source.
 *
 * Implements Accessory Mode (spec §8.1): read-only pull from Spotify.
 * Diff is computed by spotifyId — local tracks without a spotifyId are never touched.
 */

import { useState, useCallback } from 'react';
import { useUserStore } from '../stores/user-store';
import { getTracksByIds, bulkImportTracks } from '../db/services/track-service';
import { bulkAddTracksToPlaylist, removeTrackFromPlaylist } from '../db/services/playlist-service';
import type { PlaylistDocType } from '../db/schemas';

export type SyncState = 'idle' | 'syncing' | 'done' | 'error';

export interface SyncSummary {
    added: number;
    removed: number;
}

export function useSpotifySync(playlist: PlaylistDocType | null) {
    const userId = useUserStore((s) => s.userId);
    const [syncState, setSyncState] = useState<SyncState>('idle');
    const [lastSynced, setLastSynced] = useState<Date | null>(null);
    const [syncSummary, setSyncSummary] = useState<SyncSummary | null>(null);
    const [error, setError] = useState<string | null>(null);

    const syncNow = useCallback(async () => {
        if (!playlist?.linkedSpotifyId) return;

        setSyncState('syncing');
        setError(null);
        setSyncSummary(null);

        try {
            // 1. Fetch current Spotify state
            const result = await window.electron?.spotify.syncPlaylist(
                playlist.linkedSpotifyId,
                userId,
            );

            if (!result?.success || !result.tracks) {
                throw new Error(result?.error ?? 'Sync failed: no tracks returned');
            }

            // 2. Load local tracks and build spotifyId → localId map
            const localTracks = await getTracksByIds(playlist.trackIds);
            const localBySpotifyId = new Map<string, string>(
                localTracks
                    .filter((t) => t.spotifyId)
                    .map((t) => [t.spotifyId!, t.id]),
            );

            // 3. Build set of current Spotify track spotifyIds
            const spotifyIdSet = new Set(
                result.tracks.filter((t) => t.spotifyId).map((t) => t.spotifyId!),
            );

            // 4. Compute diff
            const toAdd = result.tracks.filter(
                (t) => t.spotifyId && !localBySpotifyId.has(t.spotifyId),
            );
            const toRemoveIds = [...localBySpotifyId.entries()]
                .filter(([spotifyId]) => !spotifyIdSet.has(spotifyId))
                .map(([, localId]) => localId);

            // 5. Apply diff
            if (toAdd.length > 0) {
                const newLocalIds = await bulkImportTracks(
                    toAdd.map((t) => ({
                        title: t.title,
                        artists: t.artists,
                        album: t.album,
                        durationMs: t.durationMs,
                        spotifyId: t.spotifyId,
                        addedBy: t.addedBy || userId,
                    })),
                );
                await bulkAddTracksToPlaylist(playlist.id, newLocalIds);
            }

            for (const localId of toRemoveIds) {
                await removeTrackFromPlaylist(playlist.id, localId);
            }

            setSyncSummary({ added: toAdd.length, removed: toRemoveIds.length });
            setLastSynced(new Date());
            setSyncState('done');
        } catch (err) {
            setError(String(err));
            setSyncState('error');
        }
    }, [playlist, userId]);

    return { syncState, lastSynced, syncSummary, error, syncNow };
}
