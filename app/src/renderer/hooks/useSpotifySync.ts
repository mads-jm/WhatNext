/**
 * useSpotifySync — sync a Spotify-linked playlist against the live Spotify source.
 *
 * Implements Accessory Mode (spec §8.1): read-only pull from Spotify.
 * Diff is computed by spotifyId — local tracks without a spotifyId are never touched.
 */

import { useState, useCallback } from 'react';
import { useUserStore } from '../stores/user-store';
import { getTracksByIds, bulkImportTracks, updateTrack } from '../db/services/track-service';
import { bulkAddTracksToPlaylist, removeTrackFromPlaylist } from '../db/services/playlist-service';
import { resolveSpotifyUser, createSessionParticipant } from '../db/services/user-service';
import type { PlaylistDocType } from '../db/schemas';
import type { MappedTrack } from './useSpotifyImport';

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
                // Resolve each unique Spotify user ID to a WhatNext user ID.
                const uniqueSpotifyIds = [...new Set(toAdd.map((t) => (t as MappedTrack).addedBySpotifyId).filter(Boolean))];
                const spotifyToWhatNext = new Map<string, string>();
                for (const spotifyId of uniqueSpotifyIds) {
                    const user = await resolveSpotifyUser(spotifyId);
                    if (user) {
                        spotifyToWhatNext.set(spotifyId, user.id);
                    } else {
                        const stub = await createSessionParticipant('Unknown', spotifyId);
                        spotifyToWhatNext.set(spotifyId, stub.id);
                    }
                }

                const newLocalIds = await bulkImportTracks(
                    toAdd.map((t) => {
                        const mapped = t as MappedTrack;
                        const spotifyId = mapped.addedBySpotifyId;
                        return {
                            title: t.title,
                            artists: t.artists,
                            album: t.album,
                            durationMs: t.durationMs,
                            spotifyId: t.spotifyId,
                            albumArtUrl: mapped.albumArtUrl,
                            addedBy: (spotifyId && spotifyToWhatNext.get(spotifyId)) ?? userId,
                            addedAt: mapped.addedAt,
                        };
                    }),
                );
                await bulkAddTracksToPlaylist(playlist.id, newLocalIds);
                // Fire-and-forget artwork download for newly synced tracks
                downloadArtworkForTracks(toAdd as MappedTrack[], newLocalIds);
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

async function downloadArtworkForTracks(tracks: MappedTrack[], trackIds: string[]) {
    const urlToTrackIds = new Map<string, string[]>();
    const urlToMeta = new Map<string, { albumName: string; artistName: string }>();
    tracks.forEach((t, i) => {
        if (t.albumArtUrl) {
            const ids = urlToTrackIds.get(t.albumArtUrl) ?? [];
            ids.push(trackIds[i]);
            urlToTrackIds.set(t.albumArtUrl, ids);
            if (!urlToMeta.has(t.albumArtUrl)) {
                urlToMeta.set(t.albumArtUrl, { albumName: t.album, artistName: t.artists[0] });
            }
        }
    });

    for (const [url, ids] of urlToTrackIds) {
        try {
            const result = await window.electron?.artwork.download(url, urlToMeta.get(url));
            if (result?.success && result.localPath) {
                await Promise.all(ids.map((id) => updateTrack(id, { albumArtLocalPath: result.localPath })));
            }
        } catch (err) {
            console.warn('[SpotifySync] Artwork download failed for', url, err);
        }
    }
}
