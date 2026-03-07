import React, { useState, useEffect } from 'react';
import { useDatabase } from '../../hooks/useDatabase';
import { useNavigationStore } from '../../stores/navigation-store';
import { useRxDBDocument } from '../../hooks/useRxDBCollection';
import { removeTrackFromPlaylist, updatePlaylist } from '../../db/services/playlist-service';
import { findTrackViewModels } from '../../db/query-helpers';
import type { PlaylistDocType } from '../../db/schemas';
import type { TrackViewModel } from '../../db/types';
import { ReactionBar } from '../Social/ReactionBar';
import { PlaylistComments } from '../Social/PlaylistComments';
import { CommentThread } from '../Social/CommentThread';
import { exportAndSave } from '../../services/export/export-service';
import { bulkAddTracksToPlaylist } from '../../db/services/playlist-service';
import { TrackPickerModal } from './TrackPickerModal';
import { formatDuration, formatTotalDuration } from '../../utils/format';
import { useSpotifySync } from '../../hooks/useSpotifySync';

interface PlaylistViewProps {
    playlistId?: string;
}

export function PlaylistView({ playlistId }: PlaylistViewProps) {
    const openSession = useNavigationStore((s) => s.openSession);
    const { db } = useDatabase();

    const { doc: playlist, loading: playlistLoading } = useRxDBDocument<PlaylistDocType>(
        () => db && playlistId ? db.playlists.findOne(playlistId).exec() : null,
        [db, playlistId]
    );

    const { syncState, lastSynced, syncSummary, error: syncError, syncNow } = useSpotifySync(playlist ?? null);

    const [expandedTrackComments, setExpandedTrackComments] = useState<string | null>(null);
    const [showTrackPicker, setShowTrackPicker] = useState(false);

    const [tracks, setTracks] = useState<TrackViewModel[]>([]);
    useEffect(() => {
        if (!db || !playlist) { setTracks([]); return; }
        const trackIds = playlist.trackIds;
        if (trackIds.length === 0) { setTracks([]); return; }

        findTrackViewModels(db, trackIds).then(setTracks);
    }, [db, playlist?.trackIds]);

    const totalDuration = tracks.reduce((acc, t) => acc + (t.durationMs || 0), 0);

    const handleExport = (format: 'markdown' | 'html') => {
        if (playlistId) exportAndSave(playlistId, format);
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
                                {playlist.isCollaborative ? (
                                    <button
                                        onClick={() => openSession(playlist.id)}
                                        className="btn-accent"
                                    >
                                        <i className="fa-solid fa-satellite-dish mr-1" />
                                        Open Session
                                    </button>
                                ) : playlist.linkedSpotifyId ? (
                                    <button
                                        onClick={() => updatePlaylist(playlist.id, { isCollaborative: true })}
                                        className="btn-ghost"
                                        title="Mark as collaborative to enable sessions"
                                    >
                                        <i className="fa-solid fa-users mr-1" />
                                        Enable Collaborative
                                    </button>
                                ) : null}
                                <button
                                    onClick={() => setShowTrackPicker(true)}
                                    className="btn-accent"
                                >
                                    <i className="fa-solid fa-plus mr-1" />
                                    Add tracks
                                </button>
                                <button className="btn-ghost">
                                    <i className="fa-solid fa-share-nodes mr-1" />
                                    Share
                                </button>
                                <button
                                    onClick={() => handleExport('markdown')}
                                    className="btn-ghost"
                                    title="Export as Markdown"
                                >
                                    <i className="fa-solid fa-file-lines mr-1" />
                                    Export .md
                                </button>
                                <button
                                    onClick={() => handleExport('html')}
                                    className="btn-ghost"
                                    title="Export as HTML"
                                >
                                    <i className="fa-solid fa-file-code mr-1" />
                                    Export .html
                                </button>
                                {playlist.linkedSpotifyId && (
                                    <button
                                        onClick={syncNow}
                                        disabled={syncState === 'syncing'}
                                        className="btn-ghost"
                                        title="Pull latest changes from Spotify"
                                    >
                                        <i className={`fa-brands fa-spotify mr-1${syncState === 'syncing' ? ' animate-spin' : ''}`} />
                                        {syncState === 'syncing' ? 'Syncing...' : 'Sync with Spotify'}
                                    </button>
                                )}
                            </div>
                            {playlist.linkedSpotifyId && syncState === 'done' && syncSummary && (
                                <p className="text-xs text-gray-500 mt-2">
                                    Synced {lastSynced?.toLocaleTimeString()} · +{syncSummary.added} added, {syncSummary.removed} removed
                                </p>
                            )}
                            {playlist.linkedSpotifyId && syncState === 'error' && (
                                <p className="text-xs text-red-400 mt-2">Sync failed: {syncError}</p>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {/* Playlist Discussion */}
            <PlaylistComments playlistId={playlistId!} />

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
                                    <th className="w-16"></th>
                                </tr>
                            </thead>
                            <tbody>
                                {tracks.map((track, index) => (
                                    <React.Fragment key={track.id}>
                                        <tr className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors">
                                            <td className="px-4 py-3 text-gray-500 text-sm">{index + 1}</td>
                                            <td className="px-4 py-3">
                                                <div className="font-medium text-gray-100">{track.title}</div>
                                                <div className="text-sm text-gray-400">{track.artists.join(', ')}</div>
                                                <ReactionBar trackId={track.id} playlistId={playlistId!} />
                                            </td>
                                            <td className="px-4 py-3 text-sm text-gray-400">{track.album}</td>
                                            <td className="px-4 py-3 text-sm text-gray-500">{track.addedByName ?? track.addedBy}</td>
                                            <td className="px-4 py-3 text-sm text-gray-500 text-right">
                                                {formatDuration(track.durationMs)}
                                            </td>
                                            <td className="px-4 py-3">
                                                <div className="flex items-center gap-2">
                                                    <button
                                                        onClick={() => setExpandedTrackComments(
                                                            expandedTrackComments === track.id ? null : track.id
                                                        )}
                                                        className={`transition-colors ${
                                                            expandedTrackComments === track.id
                                                                ? 'text-blue-400'
                                                                : 'text-gray-600 hover:text-gray-300'
                                                        }`}
                                                        title="Comments"
                                                    >
                                                        <i className="fa-solid fa-comment" />
                                                    </button>
                                                    <button
                                                        onClick={() => removeTrackFromPlaylist(playlistId!, track.id)}
                                                        className="text-gray-600 hover:text-red-400 transition-colors"
                                                        title="Remove track"
                                                    >
                                                        <i className="fa-solid fa-xmark" />
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                        {expandedTrackComments === track.id && (
                                            <tr className="border-b border-gray-800/50">
                                                <td colSpan={6} className="px-4 py-3 bg-gray-900/30">
                                                    <CommentThread
                                                        playlistId={playlistId!}
                                                        trackId={track.id}
                                                    />
                                                </td>
                                            </tr>
                                        )}
                                    </React.Fragment>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>
            </div>

            {/* Track Picker Modal */}
            {showTrackPicker && playlist && (
                <TrackPickerModal
                    playlistId={playlist.id}
                    existingTrackIds={playlist.trackIds}
                    onAdd={async (ids) => {
                        await bulkAddTracksToPlaylist(playlist.id, ids);
                        setShowTrackPicker(false);
                    }}
                    onClose={() => setShowTrackPicker(false)}
                />
            )}
        </div>
    );
}
