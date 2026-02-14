import { useState, useEffect } from 'react';
import { initDatabase } from '../../db/database';
import { useRxDBQuery } from '../../hooks/useRxDBCollection';
import type { PlaylistDocType, WhatNextDatabase } from '../../db/schemas';

interface PlaylistListProps {
    onPlaylistSelect?: (playlistId: string) => void;
    onCreatePlaylist?: () => void;
    selectedPlaylistId?: string;
}

export function PlaylistList({ onPlaylistSelect, onCreatePlaylist, selectedPlaylistId }: PlaylistListProps) {
    const [db, setDb] = useState<WhatNextDatabase | null>(null);

    useEffect(() => {
        initDatabase().then(setDb);
    }, []);

    const { data: playlists, loading } = useRxDBQuery<PlaylistDocType>(
        () => db ? db.playlists.find().sort({ updatedAt: 'desc' }) : null,
        [db]
    );

    const formatTimeAgo = (dateStr: string): string => {
        const diff = Date.now() - new Date(dateStr).getTime();
        const minutes = Math.floor(diff / 60000);
        if (minutes < 1) return 'just now';
        if (minutes < 60) return `${minutes}m ago`;
        const hours = Math.floor(minutes / 60);
        if (hours < 24) return `${hours}h ago`;
        const days = Math.floor(hours / 24);
        return `${days}d ago`;
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center py-12">
                <div className="text-gray-500 text-sm">Loading playlists...</div>
            </div>
        );
    }

    return (
        <div className="space-y-3">
            {/* Create Playlist Button */}
            <button
                onClick={onCreatePlaylist}
                className="w-full btn-primary flex items-center justify-center gap-2 py-3"
            >
                <i className="fa-solid fa-plus" />
                Create Playlist
            </button>

            {/* Playlist Cards */}
            {playlists.map((playlist) => (
                <div
                    key={playlist.id}
                    onClick={() => onPlaylistSelect?.(playlist.id)}
                    className={`card cursor-pointer transition-colors ${
                        selectedPlaylistId === playlist.id
                            ? 'border-blue-500 bg-blue-950/20'
                            : 'hover:border-gray-600'
                    }`}
                >
                    <div className="card-body">
                        <div className="flex items-start justify-between">
                            <div className="flex-1">
                                <div className="flex items-center gap-2">
                                    <h3 className="font-semibold text-gray-100">
                                        {playlist.playlistName}
                                    </h3>
                                    {playlist.isCollaborative && (
                                        <span className="badge-accent">
                                            <i className="fa-solid fa-users text-xs mr-1" />
                                            Shared
                                        </span>
                                    )}
                                    {playlist.queueMode === 'turn_taking' && (
                                        <span className="px-1.5 py-0.5 bg-yellow-900/50 text-yellow-400 rounded text-[10px] font-semibold">
                                            Turns
                                        </span>
                                    )}
                                </div>
                                {playlist.description && (
                                    <p className="text-xs text-gray-500 mt-1 truncate">
                                        {playlist.description}
                                    </p>
                                )}
                                <div className="flex items-center gap-3 mt-2 text-sm text-gray-500">
                                    <span>
                                        <i className="fa-solid fa-music mr-1.5" />
                                        {playlist.trackIds.length} tracks
                                    </span>
                                    <span>
                                        <i className="fa-solid fa-clock mr-1.5" />
                                        {formatTimeAgo(playlist.updatedAt)}
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            ))}

            {/* Empty State */}
            {playlists.length === 0 && (
                <div className="card">
                    <div className="card-body text-center py-12">
                        <i className="fa-solid fa-list-music text-4xl text-gray-700 mb-4" />
                        <h3 className="text-lg font-medium text-gray-400 mb-2">
                            No Playlists Yet
                        </h3>
                        <p className="text-sm text-gray-600 mb-4">
                            Create your first playlist to get started
                        </p>
                    </div>
                </div>
            )}
        </div>
    );
}
