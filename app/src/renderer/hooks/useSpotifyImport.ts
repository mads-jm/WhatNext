/**
 * useSpotifyImport — state machine + business logic for the Spotify import flow.
 * Extracted from SpotifyImport.tsx to keep the component tree purely presentational.
 */

import { useState, useEffect, useCallback } from 'react';
import { useUserStore } from '../stores/user-store';
import { bulkImportTracks } from '../db/services/track-service';
import { createPlaylist, bulkAddTracksToPlaylist } from '../db/services/playlist-service';
import { linkServiceAccount, updateLocalUserProfile } from '../db/services/user-service';

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
    addedAt: string;
    addedBy: string;
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

    // Check auth status on mount
    useEffect(() => {
        (async () => {
            try {
                const status = await window.electron?.spotify.getAuthStatus();
                if (status?.authenticated) {
                    setAuthenticated(true);
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
            const result = await window.electron?.spotify.getTracks(playlist.id, userId);
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

            const trackIds = await bulkImportTracks(
                tracksToImport.map((t) => ({
                    title: t.title,
                    artists: t.artists,
                    album: t.album,
                    durationMs: t.durationMs,
                    spotifyId: t.spotifyId,
                    addedBy: t.addedBy || userId,
                })),
            );

            const playlist = await createPlaylist({
                playlistName: selectedPlaylist!.name,
                description: selectedPlaylist!.description || undefined,
                ownerId: userId,
                linkedSpotifyId: selectedPlaylist!.id,
                spotifySyncMode: 'accessory',
                tags: ['spotify'],
            });

            await bulkAddTracksToPlaylist(playlist.id, trackIds);
            setImportCount(tracksToImport.length);
            setCreatedPlaylistId(playlist.id);
            setState('done');
        } catch (err) {
            setError(`Import failed: ${err}`);
            setState('error');
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
