/**
 * RxDB Spike Test Component
 * Issue #4: Evaluate RxDB for Local-First Data
 *
 * This component demonstrates and validates:
 * - RxDB initialization with IndexedDB (Dexie)
 * - Schema definition for Playlist and Track
 * - Reactive query streams
 * - Basic CRUD operations
 * - Data persistence across sessions
 */

import { useEffect, useState } from 'react';
import { initDatabase, getDatabase } from './database';
import type { PlaylistDocument, TrackDocument } from './schemas';
import { v4 as uuidv4 } from 'uuid';

export function RxDBSpikeTest() {
    const [status, setStatus] = useState<'initializing' | 'ready' | 'error'>(
        'initializing'
    );
    const [playlists, setPlaylists] = useState<PlaylistDocument[]>([]);
    const [tracks, setTracks] = useState<TrackDocument[]>([]);
    const [logs, setLogs] = useState<string[]>([]);

    const addLog = (message: string) => {
        console.log('[Spike]', message);
        setLogs((prev) => [...prev, `${new Date().toLocaleTimeString()}: ${message}`]);
    };

    // Initialize database on mount
    useEffect(() => {
        let isMounted = true;

        const setup = async () => {
            try {
                addLog('Initializing RxDB...');
                await initDatabase();

                if (!isMounted) return;

                addLog('Database initialized successfully');
                setStatus('ready');

                // Subscribe to reactive queries
                const db = await getDatabase();

                // Subscribe to playlists
                const playlistsSub = db.playlists
                    .find()
                    .sort({ updatedAt: 'desc' })
                    .$.subscribe((docs) => {
                        if (isMounted) {
                            setPlaylists(docs);
                            addLog(`Playlists updated: ${docs.length} total`);
                        }
                    });

                // Subscribe to tracks
                const tracksSub = db.tracks
                    .find()
                    .sort({ addedAt: 'desc' })
                    .$.subscribe((docs) => {
                        if (isMounted) {
                            setTracks(docs);
                            addLog(`Tracks updated: ${docs.length} total`);
                        }
                    });

                // Cleanup subscriptions on unmount
                return () => {
                    playlistsSub.unsubscribe();
                    tracksSub.unsubscribe();
                };
            } catch (error) {
                console.error('[Spike] Failed to initialize database:', error);
                if (isMounted) {
                    setStatus('error');
                    addLog(`Error: ${error}`);
                }
            }
        };

        setup();

        return () => {
            isMounted = false;
        };
    }, []);

    // Test: Create a sample track
    const createSampleTrack = async () => {
        try {
            const db = await getDatabase();

            // Get or create a local user to use as addedBy
            let localUser = await db.users.findOne({ selector: { isLocal: true } }).exec();
            if (!localUser) {
                const userId = uuidv4();
                await db.users.insert({
                    id: userId,
                    displayName: 'Local User',
                    isLocal: true,
                    lastSeenAt: new Date().toISOString(),
                    createdAt: new Date().toISOString(),
                });
                localUser = await db.users.findOne({ selector: { isLocal: true } }).exec();
            }

            const track = {
                id: uuidv4(),
                title: `Test Track ${Date.now()}`,
                artists: ['Artist A', 'Artist B'],
                album: 'Test Album',
                durationMs: 180000,
                addedAt: new Date().toISOString(),
                addedBy: localUser!.id,
                notes: 'Created during RxDB spike test',
            };

            await db.tracks.insert(track);
            addLog(`Created track: ${track.title}`);
        } catch (error) {
            addLog(`Error creating track: ${error}`);
        }
    };

    // Test: Create a sample playlist
    const createSamplePlaylist = async () => {
        try {
            const db = await getDatabase();

            // Get or create a local user to use as owner
            let localUser = await db.users.findOne({ selector: { isLocal: true } }).exec();
            if (!localUser) {
                const userId = uuidv4();
                await db.users.insert({
                    id: userId,
                    displayName: 'Local User',
                    isLocal: true,
                    lastSeenAt: new Date().toISOString(),
                    createdAt: new Date().toISOString(),
                });
                localUser = await db.users.findOne({ selector: { isLocal: true } }).exec();
            }

            const playlist = {
                id: uuidv4(),
                playlistName: `Test Playlist ${Date.now()}`,
                description: 'A test playlist created during spike evaluation',
                trackIds: [],
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                ownerId: localUser!.id,
                collaboratorIds: [],
                isCollaborative: false,
                isPublic: false,
                tags: ['test', 'spike'],
            };

            await db.playlists.insert(playlist);
            addLog(`Created playlist: ${playlist.playlistName}`);
        } catch (error) {
            addLog(`Error creating playlist: ${error}`);
        }
    };

    // Test: Add track to playlist
    const addTrackToPlaylist = async () => {
        try {
            if (playlists.length === 0 || tracks.length === 0) {
                addLog('Need at least one playlist and one track');
                return;
            }

            const db = await getDatabase();
            const playlist = playlists[0];
            const track = tracks[0];

            await playlist.update({
                $set: {
                    trackIds: [...playlist.trackIds, track.id],
                    updatedAt: new Date().toISOString(),
                },
            });

            addLog(
                `Added track "${track.title}" to playlist "${playlist.playlistName}"`
            );
        } catch (error) {
            addLog(`Error adding track to playlist: ${error}`);
        }
    };

    // Test: Delete all data
    const clearAllData = async () => {
        try {
            const db = await getDatabase();
            await db.playlists.find().remove();
            await db.tracks.find().remove();
            addLog('Cleared all data');
        } catch (error) {
            addLog(`Error clearing data: ${error}`);
        }
    };

    if (status === 'error') {
        return (
            <div className="card p-6 bg-red-900/20 border-red-800">
                <h2 className="text-xl font-bold text-red-400 mb-2">
                    RxDB Initialization Failed
                </h2>
                <p className="text-red-300">Check console for details</p>
            </div>
        );
    }

    if (status === 'initializing') {
        return (
            <div className="card p-6">
                <div className="flex items-center gap-3">
                    <i className="fa-solid fa-spinner fa-spin text-primary-400" />
                    <span>Initializing RxDB...</span>
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="card">
                <div className="card-header">
                    <h2 className="text-xl font-bold">
                        RxDB Spike Test
                        <span className="badge-primary ml-3">Issue #4</span>
                    </h2>
                </div>
                <div className="card-body">
                    <p className="text-gray-400 mb-4">
                        Testing RxDB with IndexedDB storage. Data persists across
                        reloads.
                    </p>
                    <div className="flex gap-2 flex-wrap">
                        <button
                            onClick={createSampleTrack}
                            className="btn-primary text-sm"
                        >
                            <i className="fa-solid fa-music" />
                            Create Track
                        </button>
                        <button
                            onClick={createSamplePlaylist}
                            className="btn-primary text-sm"
                        >
                            <i className="fa-solid fa-list" />
                            Create Playlist
                        </button>
                        <button
                            onClick={addTrackToPlaylist}
                            className="btn-accent text-sm"
                            disabled={playlists.length === 0 || tracks.length === 0}
                        >
                            <i className="fa-solid fa-plus" />
                            Add Track to Playlist
                        </button>
                        <button
                            onClick={clearAllData}
                            className="btn-ghost text-sm text-red-400 hover:text-red-300"
                        >
                            <i className="fa-solid fa-trash" />
                            Clear All
                        </button>
                    </div>
                </div>
            </div>

            {/* Data Display */}
            <div className="grid grid-cols-2 gap-6">
                {/* Playlists */}
                <div className="card">
                    <div className="card-header">
                        <h3 className="font-semibold">
                            Playlists ({playlists.length})
                        </h3>
                    </div>
                    <div className="card-body space-y-2 max-h-64 overflow-y-auto">
                        {playlists.map((playlist) => (
                            <div
                                key={playlist.id}
                                className="p-3 bg-gray-900 rounded border border-gray-800"
                            >
                                <div className="font-medium">
                                    {playlist.playlistName}
                                </div>
                                <div className="text-xs text-gray-500 mt-1">
                                    {playlist.trackIds.length} tracks •{' '}
                                    {playlist.tags.join(', ')}
                                </div>
                            </div>
                        ))}
                        {playlists.length === 0 && (
                            <div className="text-center text-gray-600 py-8">
                                No playlists yet
                            </div>
                        )}
                    </div>
                </div>

                {/* Tracks */}
                <div className="card">
                    <div className="card-header">
                        <h3 className="font-semibold">Tracks ({tracks.length})</h3>
                    </div>
                    <div className="card-body space-y-2 max-h-64 overflow-y-auto">
                        {tracks.map((track) => (
                            <div
                                key={track.id}
                                className="p-3 bg-gray-900 rounded border border-gray-800"
                            >
                                <div className="font-medium">{track.title}</div>
                                <div className="text-xs text-gray-500 mt-1">
                                    {track.artists.join(', ')} • {track.album}
                                </div>
                            </div>
                        ))}
                        {tracks.length === 0 && (
                            <div className="text-center text-gray-600 py-8">
                                No tracks yet
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Activity Log */}
            <div className="card">
                <div className="card-header">
                    <h3 className="font-semibold">Activity Log</h3>
                </div>
                <div className="card-body">
                    <div className="font-mono text-xs space-y-1 max-h-48 overflow-y-auto">
                        {logs.map((log, i) => (
                            <div key={i} className="text-gray-400">
                                {log}
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}
