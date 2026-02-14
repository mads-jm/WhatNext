/**
 * Spotify Import UI
 * Allows users to connect their Spotify account, browse playlists,
 * and import tracks into the local WhatNext database.
 */

import { useState, useEffect, useCallback } from 'react';
import { bulkImportTracks } from '../../db/services/track-service';

// Types matching what the main process returns
interface SpotifyPlaylist {
    id: string;
    name: string;
    description: string;
    images: Array<{ url: string; height: number; width: number }>;
    tracks: { total: number };
    owner: { display_name: string; id: string };
    collaborative: boolean;
    public: boolean;
}

interface MappedTrack {
    id: string;
    title: string;
    artists: string[];
    album: string;
    durationMs: number;
    spotifyId: string;
    addedAt: string;
    addedBy: string;
}

type ImportState = 'idle' | 'connecting' | 'loading-playlists' | 'browsing' | 'loading-tracks' | 'selecting' | 'importing' | 'done' | 'error';

function formatDuration(ms: number): string {
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export function SpotifyImport() {
    const [state, setState] = useState<ImportState>('idle');
    const [authenticated, setAuthenticated] = useState(false);
    const [playlists, setPlaylists] = useState<SpotifyPlaylist[]>([]);
    const [selectedPlaylist, setSelectedPlaylist] = useState<SpotifyPlaylist | null>(null);
    const [tracks, setTracks] = useState<MappedTrack[]>([]);
    const [selectedTrackIds, setSelectedTrackIds] = useState<Set<string>>(new Set());
    const [importCount, setImportCount] = useState(0);
    const [error, setError] = useState<string | null>(null);

    // Check auth status on mount
    useEffect(() => {
        checkAuthStatus();
    }, []);

    // Listen for auth completion from main process
    useEffect(() => {
        const cleanupComplete = window.electron?.spotify.onAuthComplete(() => {
            setAuthenticated(true);
            setState('idle');
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
    }, []);

    const checkAuthStatus = useCallback(async () => {
        try {
            const status = await window.electron?.spotify.getAuthStatus();
            if (status?.authenticated) {
                setAuthenticated(true);
                loadPlaylists();
            }
        } catch (err) {
            console.error('[SpotifyImport] Failed to check auth status:', err);
        }
    }, []);

    const startAuth = async () => {
        setState('connecting');
        setError(null);
        try {
            const result = await window.electron?.spotify.startAuth();
            if (result && !result.success) {
                setError(result.error || 'Failed to start authentication');
                setState('error');
            }
            // If successful, the auth flow continues in the browser.
            // We wait for the onAuthComplete callback.
        } catch (err) {
            setError(`Authentication error: ${err}`);
            setState('error');
        }
    };

    const loadPlaylists = async () => {
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
        setSelectedTrackIds(prev => {
            const next = new Set(prev);
            if (next.has(trackId)) {
                next.delete(trackId);
            } else {
                next.add(trackId);
            }
            return next;
        });
    };

    const selectAll = () => {
        setSelectedTrackIds(new Set(tracks.map(t => t.id)));
    };

    const selectNone = () => {
        setSelectedTrackIds(new Set());
    };

    const importSelected = async () => {
        setState('importing');
        setError(null);
        try {
            const tracksToImport = tracks.filter(t => selectedTrackIds.has(t.id));
            await bulkImportTracks(tracksToImport.map(t => ({
                title: t.title,
                artists: t.artists,
                album: t.album,
                durationMs: t.durationMs,
                spotifyId: t.spotifyId,
                addedBy: t.addedBy || 'spotify-import',
            })));
            setImportCount(tracksToImport.length);
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
        if (authenticated) {
            setState('browsing');
        } else {
            setState('idle');
        }
    };

    // ========================================
    // Render: Not Connected
    // ========================================
    if (!authenticated && state !== 'connecting') {
        return (
            <div className="flex items-center justify-center min-h-[400px]">
                <div className="text-center max-w-md">
                    <div className="w-16 h-16 bg-green-600 rounded-full flex items-center justify-center mx-auto mb-6">
                        <i className="fa-brands fa-spotify text-white text-3xl" />
                    </div>
                    <h2 className="text-2xl font-bold text-gray-100 mb-3">Connect to Spotify</h2>
                    <p className="text-gray-400 mb-6">
                        Import your Spotify playlists into WhatNext. Your data stays local --
                        we only read your playlist information.
                    </p>
                    <div className="space-y-3">
                        <button
                            onClick={startAuth}
                            className="w-full px-6 py-3 bg-green-600 hover:bg-green-500 text-white font-semibold rounded-lg transition-colors flex items-center justify-center gap-2"
                        >
                            <i className="fa-brands fa-spotify" />
                            Connect with Spotify
                        </button>
                        <p className="text-xs text-gray-500">
                            Uses OAuth PKCE -- no passwords are shared with WhatNext.
                            Requires a Spotify Client ID to be configured.
                        </p>
                    </div>
                    {error && (
                        <div className="mt-4 p-3 bg-red-900/50 border border-red-700 rounded-lg text-red-300 text-sm">
                            {error}
                        </div>
                    )}
                </div>
            </div>
        );
    }

    // ========================================
    // Render: Connecting (waiting for browser auth)
    // ========================================
    if (state === 'connecting') {
        return (
            <div className="flex items-center justify-center min-h-[400px]">
                <div className="text-center max-w-md">
                    <div className="w-16 h-16 border-4 border-green-600 border-t-transparent rounded-full animate-spin mx-auto mb-6" />
                    <h2 className="text-xl font-bold text-gray-100 mb-3">Waiting for Spotify...</h2>
                    <p className="text-gray-400 mb-4">
                        A browser window should have opened. Complete the login there,
                        and you will be redirected back automatically.
                    </p>
                    <button
                        onClick={resetAll}
                        className="text-sm text-gray-500 hover:text-gray-300 transition-colors"
                    >
                        Cancel
                    </button>
                </div>
            </div>
        );
    }

    // ========================================
    // Render: Loading Playlists
    // ========================================
    if (state === 'loading-playlists') {
        return (
            <div className="flex items-center justify-center min-h-[400px]">
                <div className="text-center">
                    <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
                    <p className="text-gray-400">Loading your playlists...</p>
                </div>
            </div>
        );
    }

    // ========================================
    // Render: Import Complete
    // ========================================
    if (state === 'done') {
        return (
            <div className="flex items-center justify-center min-h-[400px]">
                <div className="text-center max-w-md">
                    <div className="w-16 h-16 bg-green-600 rounded-full flex items-center justify-center mx-auto mb-6">
                        <i className="fa-solid fa-check text-white text-2xl" />
                    </div>
                    <h2 className="text-2xl font-bold text-gray-100 mb-3">Import Complete!</h2>
                    <p className="text-gray-400 mb-6">
                        Successfully imported <span className="text-green-400 font-semibold">{importCount}</span> tracks
                        {selectedPlaylist && (
                            <> from <span className="text-gray-200 font-medium">{selectedPlaylist.name}</span></>
                        )}.
                    </p>
                    <div className="flex gap-3 justify-center">
                        <button
                            onClick={goBackToPlaylists}
                            className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded-lg transition-colors"
                        >
                            Import More
                        </button>
                        <button
                            onClick={resetAll}
                            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors"
                        >
                            Done
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    // ========================================
    // Render: Error State
    // ========================================
    if (state === 'error') {
        return (
            <div className="flex items-center justify-center min-h-[400px]">
                <div className="text-center max-w-md">
                    <div className="w-16 h-16 bg-red-600 rounded-full flex items-center justify-center mx-auto mb-6">
                        <i className="fa-solid fa-exclamation-triangle text-white text-2xl" />
                    </div>
                    <h2 className="text-xl font-bold text-gray-100 mb-3">Something went wrong</h2>
                    <div className="p-3 bg-red-900/50 border border-red-700 rounded-lg text-red-300 text-sm mb-6">
                        {error}
                    </div>
                    <button
                        onClick={resetAll}
                        className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded-lg transition-colors"
                    >
                        Try Again
                    </button>
                </div>
            </div>
        );
    }

    // ========================================
    // Render: Track Selection
    // ========================================
    if ((state === 'selecting' || state === 'loading-tracks' || state === 'importing') && selectedPlaylist) {
        return (
            <div className="space-y-4">
                {/* Header */}
                <div className="flex items-center gap-4">
                    <button
                        onClick={goBackToPlaylists}
                        className="p-2 hover:bg-gray-700 rounded-lg transition-colors text-gray-400 hover:text-gray-200"
                    >
                        <i className="fa-solid fa-arrow-left" />
                    </button>
                    <div className="flex items-center gap-3 flex-1">
                        {selectedPlaylist.images?.[0] && (
                            <img
                                src={selectedPlaylist.images[0].url}
                                alt={selectedPlaylist.name}
                                className="w-12 h-12 rounded-md object-cover"
                            />
                        )}
                        <div>
                            <h2 className="text-lg font-bold text-gray-100">{selectedPlaylist.name}</h2>
                            <p className="text-sm text-gray-400">
                                {selectedPlaylist.tracks.total} tracks by {selectedPlaylist.owner.display_name}
                            </p>
                        </div>
                    </div>
                </div>

                {/* Loading tracks spinner */}
                {state === 'loading-tracks' && (
                    <div className="flex items-center justify-center py-12">
                        <div className="text-center">
                            <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
                            <p className="text-gray-400 text-sm">Loading tracks...</p>
                        </div>
                    </div>
                )}

                {/* Track list */}
                {state === 'selecting' && (
                    <>
                        {/* Selection toolbar */}
                        <div className="flex items-center justify-between bg-gray-800 rounded-lg px-4 py-3">
                            <div className="flex items-center gap-3">
                                <span className="text-sm text-gray-300">
                                    <span className="text-blue-400 font-semibold">{selectedTrackIds.size}</span> of {tracks.length} selected
                                </span>
                                <div className="flex gap-2">
                                    <button
                                        onClick={selectAll}
                                        className="text-xs px-2 py-1 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded transition-colors"
                                    >
                                        Select All
                                    </button>
                                    <button
                                        onClick={selectNone}
                                        className="text-xs px-2 py-1 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded transition-colors"
                                    >
                                        Select None
                                    </button>
                                </div>
                            </div>
                            <button
                                onClick={importSelected}
                                disabled={selectedTrackIds.size === 0}
                                className={`px-4 py-2 rounded-lg font-semibold text-sm transition-colors flex items-center gap-2 ${
                                    selectedTrackIds.size > 0
                                        ? 'bg-green-600 hover:bg-green-500 text-white'
                                        : 'bg-gray-700 text-gray-500 cursor-not-allowed'
                                }`}
                            >
                                <i className="fa-solid fa-download" />
                                Import {selectedTrackIds.size} Track{selectedTrackIds.size !== 1 ? 's' : ''}
                            </button>
                        </div>

                        {/* Track rows */}
                        <div className="bg-gray-800 rounded-lg overflow-hidden">
                            {/* Header row */}
                            <div className="grid grid-cols-12 gap-2 px-4 py-2 border-b border-gray-700 text-xs text-gray-500 uppercase tracking-wider">
                                <div className="col-span-1">#</div>
                                <div className="col-span-5">Title</div>
                                <div className="col-span-3">Album</div>
                                <div className="col-span-2">Artists</div>
                                <div className="col-span-1 text-right">Duration</div>
                            </div>

                            {/* Track items */}
                            <div className="max-h-[500px] overflow-y-auto">
                                {tracks.map((track, index) => (
                                    <button
                                        key={track.id}
                                        onClick={() => toggleTrack(track.id)}
                                        className={`w-full grid grid-cols-12 gap-2 px-4 py-2.5 text-left text-sm transition-colors border-b border-gray-700/50 last:border-0 ${
                                            selectedTrackIds.has(track.id)
                                                ? 'bg-blue-900/20 hover:bg-blue-900/30'
                                                : 'hover:bg-gray-700/50'
                                        }`}
                                    >
                                        <div className="col-span-1 flex items-center">
                                            <div className={`w-5 h-5 rounded border flex items-center justify-center text-xs ${
                                                selectedTrackIds.has(track.id)
                                                    ? 'bg-blue-600 border-blue-600 text-white'
                                                    : 'border-gray-600'
                                            }`}>
                                                {selectedTrackIds.has(track.id) ? (
                                                    <i className="fa-solid fa-check" />
                                                ) : (
                                                    <span className="text-gray-500">{index + 1}</span>
                                                )}
                                            </div>
                                        </div>
                                        <div className="col-span-5 truncate text-gray-200">{track.title}</div>
                                        <div className="col-span-3 truncate text-gray-400">{track.album}</div>
                                        <div className="col-span-2 truncate text-gray-400">{track.artists.join(', ')}</div>
                                        <div className="col-span-1 text-right text-gray-500">{formatDuration(track.durationMs)}</div>
                                    </button>
                                ))}
                            </div>
                        </div>
                    </>
                )}

                {/* Importing spinner */}
                {state === 'importing' && (
                    <div className="flex items-center justify-center py-12">
                        <div className="text-center">
                            <div className="w-10 h-10 border-4 border-green-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
                            <p className="text-gray-400 text-sm">Importing {selectedTrackIds.size} tracks...</p>
                        </div>
                    </div>
                )}
            </div>
        );
    }

    // ========================================
    // Render: Playlist Browser
    // ========================================
    return (
        <div className="space-y-4">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="w-8 h-8 bg-green-600 rounded-full flex items-center justify-center">
                        <i className="fa-brands fa-spotify text-white text-sm" />
                    </div>
                    <div>
                        <h2 className="text-lg font-bold text-gray-100">Your Spotify Playlists</h2>
                        <p className="text-sm text-gray-400">{playlists.length} playlists found</p>
                    </div>
                </div>
                <button
                    onClick={loadPlaylists}
                    className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-lg text-sm transition-colors flex items-center gap-2"
                >
                    <i className="fa-solid fa-refresh" />
                    Refresh
                </button>
            </div>

            {/* Playlist Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {playlists.map(playlist => (
                    <button
                        key={playlist.id}
                        onClick={() => loadTracks(playlist)}
                        className="flex items-start gap-3 p-3 bg-gray-800 hover:bg-gray-700 rounded-lg transition-colors text-left group"
                    >
                        {/* Cover art */}
                        <div className="w-16 h-16 bg-gray-700 rounded-md flex-shrink-0 overflow-hidden">
                            {playlist.images?.[0] ? (
                                <img
                                    src={playlist.images[0].url}
                                    alt={playlist.name}
                                    className="w-full h-full object-cover"
                                />
                            ) : (
                                <div className="w-full h-full flex items-center justify-center">
                                    <i className="fa-solid fa-music text-gray-500" />
                                </div>
                            )}
                        </div>

                        {/* Info */}
                        <div className="flex-1 min-w-0">
                            <h3 className="font-semibold text-gray-200 truncate group-hover:text-white transition-colors">
                                {playlist.name}
                            </h3>
                            <p className="text-xs text-gray-500 mt-0.5">
                                {playlist.owner.display_name}
                            </p>
                            <div className="flex items-center gap-2 mt-1.5">
                                <span className="text-xs text-gray-400">
                                    {playlist.tracks.total} tracks
                                </span>
                                {playlist.collaborative && (
                                    <span className="text-xs px-1.5 py-0.5 bg-blue-900/50 text-blue-400 rounded">
                                        Collaborative
                                    </span>
                                )}
                                {playlist.public === false && (
                                    <span className="text-xs px-1.5 py-0.5 bg-gray-700 text-gray-400 rounded">
                                        Private
                                    </span>
                                )}
                            </div>
                        </div>

                        {/* Arrow */}
                        <i className="fa-solid fa-chevron-right text-gray-600 group-hover:text-gray-400 transition-colors mt-4" />
                    </button>
                ))}
            </div>

            {playlists.length === 0 && state === 'browsing' && (
                <div className="text-center py-12 text-gray-500">
                    <i className="fa-solid fa-music text-3xl mb-3 block" />
                    <p>No playlists found on your Spotify account.</p>
                </div>
            )}
        </div>
    );
}
