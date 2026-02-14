import { useState, useEffect } from 'react';
import { initDatabase } from '../../db/database';
import { useRxDBDocument } from '../../hooks/useRxDBCollection';
import { removeTrackFromPlaylist } from '../../db/services/playlist-service';
import { findTrackViewModels } from '../../db/query-helpers';
import type { PlaylistDocType, WhatNextDatabase } from '../../db/schemas';
import type { TrackViewModel } from '../../db/types';

interface PlaylistViewProps {
    playlistId?: string;
    onOpenSession?: (playlistId: string) => void;
}

export function PlaylistView({ playlistId, onOpenSession }: PlaylistViewProps) {
    const [db, setDb] = useState<WhatNextDatabase | null>(null);

    useEffect(() => {
        initDatabase().then(setDb);
    }, []);

    const { doc: playlist, loading: playlistLoading } = useRxDBDocument<PlaylistDocType>(
        () => db && playlistId ? db.playlists.findOne(playlistId).exec() : null,
        [db, playlistId]
    );

    const [tracks, setTracks] = useState<TrackViewModel[]>([]);
    useEffect(() => {
        if (!db || !playlist) { setTracks([]); return; }
        const trackIds = playlist.trackIds;
        if (trackIds.length === 0) { setTracks([]); return; }

        findTrackViewModels(db, trackIds).then(setTracks);
    }, [db, playlist?.trackIds]);

    const formatDuration = (ms: number): string => {
        const minutes = Math.floor(ms / 60000);
        const seconds = Math.floor((ms % 60000) / 1000);
        return `${minutes}:${seconds.toString().padStart(2, '0')}`;
    };

    const totalDuration = tracks.reduce((acc, t) => acc + (t.durationMs || 0), 0);
    const formatTotalDuration = (ms: number): string => {
        const hours = Math.floor(ms / 3600000);
        const minutes = Math.floor((ms % 3600000) / 60000);
        return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
    };

    if (!playlistId) {
        return (
            <div className="flex items-center justify-center h-full text-gray-600">
                <div className="text-center">
                    <i className="fa-solid fa-arrow-left text-4xl mb-4" />
                    <p>Select a playlist to view details</p>
                </div>
            </div>
        );
    }

    if (playlistLoading) {
        return <div className="text-gray-500 text-center py-12">Loading...</div>;
    }

    if (!playlist) {
        return <div className="text-gray-500 text-center py-12">Playlist not found</div>;
    }

    return (
        <div className="h-full flex flex-col">
            {/* Playlist Header */}
            <div className="card mb-4">
                <div className="card-body">
                    <div className="flex items-start gap-4">
                        <div className="w-32 h-32 rounded-lg bg-gradient-to-br from-blue-600 to-purple-600 flex items-center justify-center shrink-0">
                            <i className="fa-solid fa-music text-4xl text-white opacity-50" />
                        </div>
                        <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                                <span className="badge-muted">Playlist</span>
                                {playlist.isCollaborative && <span className="badge-accent">Collaborative</span>}
                                {playlist.queueMode === 'turn_taking' && (
                                    <span className="px-1.5 py-0.5 bg-yellow-900/50 text-yellow-400 rounded text-[10px] font-semibold">
                                        Turn-Taking
                                    </span>
                                )}
                            </div>
                            <h2 className="text-3xl font-bold mb-2">{playlist.playlistName}</h2>
                            {playlist.description && (
                                <p className="text-sm text-gray-400 mb-2">{playlist.description}</p>
                            )}
                            <p className="text-sm text-gray-500 mb-4">
                                {tracks.length} tracks {totalDuration > 0 && <>• {formatTotalDuration(totalDuration)}</>}
                            </p>
                            <div className="flex gap-2">
                                {playlist.isCollaborative && onOpenSession && (
                                    <button
                                        onClick={() => onOpenSession(playlist.id)}
                                        className="btn-accent"
                                    >
                                        <i className="fa-solid fa-satellite-dish mr-1" />
                                        Open Session
                                    </button>
                                )}
                                <button className="btn-ghost">
                                    <i className="fa-solid fa-share-nodes mr-1" />
                                    Share
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Track List */}
            <div className="card flex-1 overflow-hidden flex flex-col">
                <div className="card-header flex items-center justify-between">
                    <span className="font-medium">Tracks ({tracks.length})</span>
                </div>
                <div className="flex-1 overflow-y-auto">
                    {tracks.length === 0 ? (
                        <div className="text-center py-12 text-gray-600">
                            <i className="fa-solid fa-music text-4xl mb-4" />
                            <p>No tracks yet</p>
                            <p className="text-sm mt-2">Import tracks from Spotify or add them manually</p>
                        </div>
                    ) : (
                        <table className="w-full">
                            <thead className="text-xs text-gray-500 uppercase border-b border-gray-800">
                                <tr>
                                    <th className="text-left px-4 py-2 w-8">#</th>
                                    <th className="text-left px-4 py-2">Title</th>
                                    <th className="text-left px-4 py-2">Album</th>
                                    <th className="text-left px-4 py-2">Added By</th>
                                    <th className="text-right px-4 py-2">Duration</th>
                                    <th className="w-8"></th>
                                </tr>
                            </thead>
                            <tbody>
                                {tracks.map((track, index) => (
                                    <tr
                                        key={track.id}
                                        className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors"
                                    >
                                        <td className="px-4 py-3 text-gray-500 text-sm">{index + 1}</td>
                                        <td className="px-4 py-3">
                                            <div className="font-medium text-gray-100">{track.title}</div>
                                            <div className="text-sm text-gray-400">{track.artists.join(', ')}</div>
                                        </td>
                                        <td className="px-4 py-3 text-sm text-gray-400">{track.album}</td>
                                        <td className="px-4 py-3 text-sm text-gray-500">{track.addedBy}</td>
                                        <td className="px-4 py-3 text-sm text-gray-500 text-right">
                                            {formatDuration(track.durationMs)}
                                        </td>
                                        <td className="px-4 py-3">
                                            <button
                                                onClick={() => removeTrackFromPlaylist(playlistId!, track.id)}
                                                className="text-gray-600 hover:text-red-400 transition-colors"
                                                title="Remove track"
                                            >
                                                <i className="fa-solid fa-xmark" />
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>
            </div>
        </div>
    );
}
