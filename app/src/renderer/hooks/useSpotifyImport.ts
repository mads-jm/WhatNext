/**
 * useSpotifyImport — state machine + business logic for the Spotify import flow.
 * Extracted from SpotifyImport.tsx to keep the component tree purely presentational.
 */

import { useState, useEffect, useCallback } from 'react';
import { useUserStore } from '../stores/user-store';
import { bulkImportTracks, updateTrack } from '../db/services/track-service';
import { createPlaylist, bulkAddTracksToPlaylist } from '../db/services/playlist-service';
import { linkServiceAccount, updateLocalUserProfile, resolveSpotifyUser, createSessionParticipant } from '../db/services/user-service';
import { resolveSpotifyUsers } from '../utils/spotify-user-resolution';
import { groupTracksByArtwork, downloadArtworkBatch } from '../utils/artwork-download';

export interface SpotifyPlaylist {
    id: string;
    name: string;
    description: string;
    images: Array<{ url: string; height: number; width: number }>;
    tracks: { total: number };
    owner: { display_name: string; id: string };
    collaborative: boolean;
    public: boolean;
}

export interface MappedTrack {
    id: string;
    title: string;
    artists: string[];
    album: string;
    durationMs: number;
    spotifyId: string;
    albumArtUrl?: string;
    addedAt: string;
    addedBySpotifyId: string; // Spotify user ID — resolved to WhatNext userId before writing to RxDB
    addedByDisplayName?: string; // Spotify display name (when available)
}

export type ImportState =
    | 'idle'
    | 'connecting'
    | 'loading-playlists'
    | 'browsing'
    | 'loading-tracks'
    | 'selecting'
    | 'importing'
    | 'done'
    | 'error';

export function useSpotifyImport() {
    const userId = useUserStore((s) => s.userId);
    const [state, setState] = useState<ImportState>('idle');
    const [authenticated, setAuthenticated] = useState(false);
    const [playlists, setPlaylists] = useState<SpotifyPlaylist[]>([]);
    const [selectedPlaylist, setSelectedPlaylist] = useState<SpotifyPlaylist | null>(null);
    const [tracks, setTracks] = useState<MappedTrack[]>([]);
    const [selectedTrackIds, setSelectedTrackIds] = useState<Set<string>>(new Set());
    const [importCount, setImportCount] = useState(0);
    const [createdPlaylistId, setCreatedPlaylistId] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const loadPlaylists = useCallback(async () => {
        setState('loading-playlists');
        setError(null);
        try {
            const result = await window.electron?.spotify.getPlaylists();
            if (result?.success && result.playlists) {
                setPlaylists(result.playlists);
                setState('browsing');
            } else {
                setError(result?.error || 'Failed to load playlists');
                setState('error');
            }
        } catch (err) {
            setError(`Failed to load playlists: ${err}`);
            setState('error');
        }
    }, []);

    // Check auth status on mount — ensure Spotify profile is linked to local user
    useEffect(() => {
        (async () => {
            try {
                const status = await window.electron?.spotify.getAuthStatus();
                if (status?.authenticated) {
                    setAuthenticated(true);

                    // Ensure Spotify profile is linked (may have been skipped if auth
                    // happened in a previous app session and onAuthComplete didn't fire)
                    try {
                        const profile = await window.electron?.spotify.getProfile();
                        if (profile?.success && profile.userId) {
                            await linkServiceAccount({
                                provider: 'spotify',
                                providerUserId: profile.userId,
                                displayName: profile.displayName,
                                avatarUrl: profile.avatarUrl,
                            });
                            const user = useUserStore.getState().user;
                            if (user?.avatarSource === 'none' && profile.avatarUrl) {
                                await updateLocalUserProfile({
                                    avatarSource: 'spotify',
                                    avatarUrl: profile.avatarUrl,
                                });
                            }
                        }
                    } catch (err) {
                        console.error('[SpotifyImport] Failed to link Spotify profile on mount:', err);
                    }

                    loadPlaylists();
                }
            } catch (err) {
                console.error('[SpotifyImport] Failed to check auth status:', err);
            }
        })();
    }, [loadPlaylists]);

    // Listen for auth completion from main process
    useEffect(() => {
        const cleanupComplete = window.electron?.spotify.onAuthComplete(async () => {
            setAuthenticated(true);
            setState('idle');

            // Link Spotify profile to local user identity
            try {
                const profile = await window.electron?.spotify.getProfile();
                if (profile?.success && profile.userId) {
                    await linkServiceAccount({
                        provider: 'spotify',
                        providerUserId: profile.userId,
                        displayName: profile.displayName,
                        avatarUrl: profile.avatarUrl,
                    });
                    // Auto-set avatar if user doesn't have one
                    const user = useUserStore.getState().user;
                    if (user?.avatarSource === 'none' && profile.avatarUrl) {
                        await updateLocalUserProfile({
                            avatarSource: 'spotify',
                            avatarUrl: profile.avatarUrl,
                        });
                    }
                }
            } catch (err) {
                console.error('[SpotifyImport] Failed to link Spotify profile:', err);
            }

            loadPlaylists();
        });

        const cleanupError = window.electron?.spotify.onAuthError((data) => {
            setError(data.error);
            setState('error');
        });

        return () => {
            cleanupComplete?.();
            cleanupError?.();
        };
    }, [loadPlaylists]);

    const startAuth = async () => {
        setState('connecting');
        setError(null);
        try {
            const result = await window.electron?.spotify.startAuth();
            if (result && !result.success) {
                setError(result.error || 'Failed to start authentication');
                setState('error');
            }
        } catch (err) {
            setError(`Authentication error: ${err}`);
            setState('error');
        }
    };

    const loadTracks = async (playlist: SpotifyPlaylist) => {
        setSelectedPlaylist(playlist);
        setState('loading-tracks');
        setError(null);
        try {
            const result = await window.electron?.spotify.getTracks(playlist.id);
            if (result?.success && result.tracks) {
                setTracks(result.tracks);
                setSelectedTrackIds(new Set(result.tracks.map((t: MappedTrack) => t.id)));
                setState('selecting');
            } else {
                setError(result?.error || 'Failed to load tracks');
                setState('error');
            }
        } catch (err) {
            setError(`Failed to load tracks: ${err}`);
            setState('error');
        }
    };

    const toggleTrack = (trackId: string) => {
        setSelectedTrackIds((prev) => {
            const next = new Set(prev);
            if (next.has(trackId)) next.delete(trackId);
            else next.add(trackId);
            return next;
        });
    };

    const selectAll = () => setSelectedTrackIds(new Set(tracks.map((t) => t.id)));
    const selectNone = () => setSelectedTrackIds(new Set());

    const importSelected = async () => {
        setState('importing');
        setError(null);
        try {
            const tracksToImport = tracks.filter((t) => selectedTrackIds.has(t.id));
            const coverArtUrl = selectedPlaylist?.images?.[0]?.url;

            // Resolve each unique Spotify user ID to a WhatNext user ID.
            const spotifyToWhatNext = await resolveSpotifyUsers(
                tracksToImport,
                resolveSpotifyUser,
                createSessionParticipant,
            );

            const trackIds = await bulkImportTracks(
                tracksToImport.map((t) => ({
                    title: t.title,
                    artists: t.artists,
                    album: t.album,
                    durationMs: t.durationMs,
                    spotifyId: t.spotifyId,
                    albumArtUrl: t.albumArtUrl,
                    addedBy: spotifyToWhatNext.get(t.addedBySpotifyId) ?? userId,
                    addedAt: t.addedAt,
                })),
            );

            // Collaborators are all resolved Spotify users except the local user
            const collaboratorIds = [...spotifyToWhatNext.values()].filter((id) => id !== userId);

            const playlist = await createPlaylist({
                playlistName: selectedPlaylist!.name,
                description: selectedPlaylist!.description || undefined,
                ownerId: userId,
                collaboratorIds,
                linkedSpotifyId: selectedPlaylist!.id,
                spotifySyncMode: 'accessory',
                isCollaborative: selectedPlaylist!.collaborative || collaboratorIds.length > 0,
                tags: ['spotify'],
                coverArtUrl,
            });

            await bulkAddTracksToPlaylist(playlist.id, trackIds);
            setImportCount(tracksToImport.length);
            setCreatedPlaylistId(playlist.id);
            setState('done');

            // Fire-and-forget: download artwork in background after import completes
            downloadArtworkInBackground(tracksToImport, trackIds, playlist.id, coverArtUrl, selectedPlaylist!.name);
        } catch (err) {
            setError(`Import failed: ${err}`);
            setState('error');
        }
    };

    /**
     * Download and cache artwork locally after a successful import.
     * Runs in background — does not block the import flow or update UI state.
     */
    const downloadArtworkInBackground = async (
        importedTracks: MappedTrack[],
        trackIds: string[],
        playlistId: string,
        coverArtUrl?: string,
        playlistName?: string,
    ) => {
        const groups = groupTracksByArtwork(importedTracks, trackIds);
        const download = (url: string, meta?: { albumName: string; artistName: string }) =>
            window.electron?.artwork.download(url, meta) ?? Promise.resolve({ success: false });
        const updatePath = (id: string, localPath: string) =>
            updateTrack(id, { albumArtLocalPath: localPath }).then(() => {});

        await downloadArtworkBatch(groups, download, updatePath);

        // Download playlist cover art
        if (coverArtUrl) {
            try {
                const result = await window.electron?.artwork.download(coverArtUrl, { albumName: playlistName });
                if (result?.success && result.localPath) {
                    const db = await import('../db/database').then((m) => m.getDatabase());
                    const playlistDoc = await db.playlists.findOne(playlistId).exec();
                    await playlistDoc?.update({ $set: { coverArtLocalPath: result.localPath } });
                }
            } catch (err) {
                console.warn('[SpotifyImport] Playlist cover download failed:', err);
            }
        }
    };

    const goBackToPlaylists = () => {
        setSelectedPlaylist(null);
        setTracks([]);
        setSelectedTrackIds(new Set());
        setState('browsing');
    };

    const resetAll = () => {
        setSelectedPlaylist(null);
        setTracks([]);
        setSelectedTrackIds(new Set());
        setImportCount(0);
        setError(null);
        setState(authenticated ? 'browsing' : 'idle');
    };

    return {
        state,
        authenticated,
        playlists,
        selectedPlaylist,
        tracks,
        selectedTrackIds,
        importCount,
        createdPlaylistId,
        error,
        startAuth,
        loadPlaylists,
        loadTracks,
        toggleTrack,
        selectAll,
        selectNone,
        importSelected,
        goBackToPlaylists,
        resetAll,
    };
}
