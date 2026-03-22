import React, { useState, useEffect, useRef } from 'react';
import { useDatabase } from '../../hooks/useDatabase';
import { useNavigationStore } from '../../stores/navigation-store';
import { useUserStore } from '../../stores/user-store';
import { useRxDBDocument } from '../../hooks/useRxDBCollection';
import { removeTrackFromPlaylist, updatePlaylist } from '../../db/services/playlist-service';
import { toggleReaction } from '../../db/services/reaction-service';
import { ALLOWED_REACTIONS, REACTION_DISPLAY, type ReactionEmoji } from '../../../shared/core/reactions';
import { pushLocalChanges } from '../../db/replication-handler';
import { ContextMenu, type ContextMenuItem } from '../shared/ContextMenu';
import { useContextMenu } from '../../hooks/useContextMenu';
import { findTrackViewModels } from '../../db/query-helpers';
import type { PlaylistDocType, UserDocType } from '../../db/schemas';
import type { TrackViewModel } from '../../db/types';
import { ReactionBar } from '../Social/ReactionBar';
import { PlaylistComments } from '../Social/PlaylistComments';
import { CommentThread } from '../Social/CommentThread';
import { exportAndSave } from '../../services/export/export-service';
import { bulkAddTracksToPlaylist } from '../../db/services/playlist-service';
import { TrackPickerModal } from './TrackPickerModal';
import { TurnManagementPanel } from './TurnManagementPanel';
import { TurnSetupModal } from './TurnSetupModal';
import { formatDuration, formatTotalDuration } from '../../utils/format';
import { artSrc } from '../../utils/artSrc';
import { useSpotifySync } from '../../hooks/useSpotifySync';

const EMOJI_LABELS: Record<ReactionEmoji, string> = {
    fire: 'Fire',
    heart: 'Love',
    thumbsdown: 'Nah',
    mindblown: 'Mind Blown',
    sleeping: 'Boring',
    party: 'Party',
};

interface PlaylistViewProps {
    playlistId?: string;
}

export function PlaylistView({ playlistId }: PlaylistViewProps) {
    const openSession = useNavigationStore((s) => s.openSession);
    const { db } = useDatabase();
    const userId = useUserStore((s) => s.userId);

    const { doc: playlist, loading: playlistLoading } = useRxDBDocument<PlaylistDocType>(
        () => db && playlistId ? db.playlists.findOne(playlistId).exec() : null,
        [db, playlistId]
    );

    const { syncState, lastSynced, syncSummary, error: syncError, syncNow } = useSpotifySync(playlist ?? null);

    const { menuState: trackMenuState, openMenu: openTrackMenu, closeMenu: closeTrackMenu } =
        useContextMenu();

    const [expandedTrackComments, setExpandedTrackComments] = useState<string | null>(null);
    const [showTrackPicker, setShowTrackPicker] = useState(false);
    const [exportOpen, setExportOpen] = useState(false);
    const exportRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!exportOpen) return;
        const handler = (e: MouseEvent) => {
            if (exportRef.current && !exportRef.current.contains(e.target as Node)) {
                setExportOpen(false);
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [exportOpen]);

    const [tracks, setTracks] = useState<TrackViewModel[]>([]);
    useEffect(() => {
        if (!db || !playlist) { setTracks([]); return; }
        const trackIds = playlist.trackIds;
        if (trackIds.length === 0) { setTracks([]); return; }

        findTrackViewModels(db, trackIds).then(setTracks);
    }, [db, playlist?.trackIds]);

    // Load participants for the TurnManagementPanel
    const [participants, setParticipants] = useState<UserDocType[]>([]);
    useEffect(() => {
        if (!db || !playlist || !playlist.isCollaborative) {
            setParticipants([]);
            return;
        }
        const ids = [playlist.ownerId, ...playlist.collaboratorIds];
        db.users.findByIds(ids).exec().then((map) => {
            setParticipants(
                ids
                    .map((id) => map.get(id))
                    .filter((u): u is NonNullable<typeof u> => u !== undefined)
                    .map((u) => u.toJSON() as UserDocType)
            );
        });
    }, [db, playlist?.ownerId, playlist?.collaboratorIds?.join(','), playlist?.isCollaborative]);

    const totalDuration = tracks.reduce((acc, t) => acc + (t.durationMs || 0), 0);

    const buildTrackMenuItems = (track: { id: string; title: string }): ContextMenuItem[] => [
        {
            id: 'quick-react',
            label: 'Quick React',
            icon: '😊',
            subItems: ALLOWED_REACTIONS.map((emoji) => ({
                id: `react-${emoji}`,
                label: EMOJI_LABELS[emoji],
                icon: REACTION_DISPLAY[emoji],
                action: () => toggleReaction(userId, track.id, playlistId!, emoji, pushLocalChanges),
            })),
        },
        { id: 'sep-1', label: '', separator: true },
        {
            id: 'remove',
            label: 'Remove Track',
            icon: 'fa-solid fa-trash',
            variant: 'danger',
            requiresConfirm: true,
            confirmLabel: `Remove "${track.title}"?`,
            action: () => removeTrackFromPlaylist(playlistId!, track.id),
        },
    ];

    const handleExport = (format: 'markdown' | 'html') => {
        if (playlistId) exportAndSave(playlistId, format);
    };

    if (!playlistId) {
        return (
            <div className="flex items-center justify-center h-full text-on-surface-variant">
                <div className="text-center">
                    <i className="fa-solid fa-arrow-left text-4xl mb-4" />
                    <p>Select a playlist to view details</p>
                </div>
            </div>
        );
    }

    if (playlistLoading) {
        return <div className="text-on-surface-variant text-center py-12">Loading...</div>;
    }

    if (!playlist) {
        return <div className="text-on-surface-variant text-center py-12">Playlist not found</div>;
    }

    return (
        <div className="h-full flex flex-col">
            {/* Playlist Header */}
            <div className="card mb-4">
                <div className="card-body">
                    <div className="flex items-start gap-4">
                        <div className="w-32 h-32 rounded-lg shrink-0 overflow-hidden bg-gradient-to-br from-primary-dim to-primary flex items-center justify-center">
                            {playlist.coverArtLocalPath || playlist.coverArtUrl ? (
                                <img
                                    src={artSrc(playlist.coverArtLocalPath, playlist.coverArtUrl)}
                                    alt={playlist.playlistName}
                                    className="w-full h-full object-cover"
                                    onError={(e) => {
                                        if (playlist.coverArtUrl) e.currentTarget.src = playlist.coverArtUrl;
                                    }}
                                />
                            ) : (
                                <i className="fa-solid fa-music text-4xl text-on-surface opacity-50" />
                            )}
                        </div>
                        <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                                <span className="badge-muted">
                                    <i className="fa-solid fa-headphones text-xs mr-1" />
                                    Playlist
                                </span>
                                {playlist.isCollaborative && (
                                    <span className="badge-accent">
                                        <i className="fa-solid fa-users text-xs mr-1" />
                                        Shared
                                    </span>
                                )}
                                {playlist.queueMode === 'turn_taking' && !playlist.isComplete && (
                                    <span className="px-1.5 py-0.5 bg-secondary/15 text-secondary rounded text-[10px] font-semibold">
                                        Turn-Taking
                                    </span>
                                )}
                                {playlist.isComplete && (
                                    <span className="px-1.5 py-0.5 bg-surface-high text-on-surface-variant rounded text-[10px] font-semibold" title={`Completed from: ${playlist.completedFromMode ?? 'collaborative'}`}>
                                        Complete
                                    </span>
                                )}
                            </div>
                            <h2 className="text-3xl font-bold mb-2">{playlist.playlistName}</h2>
                            {playlist.description && (
                                <p className="text-sm text-on-surface-variant mb-2">{playlist.description}</p>
                            )}
                            <p className="text-sm text-on-surface-variant mb-4">
                                {tracks.length} tracks {totalDuration > 0 && <>• {formatTotalDuration(totalDuration)}</>}
                            </p>
                            <div className="flex gap-2">
                                {playlist.isCollaborative ? (
                                    <button
                                        onClick={() => openSession(playlist.id)}
                                        className="btn-primary"
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
                                    className="btn-primary"
                                >
                                    <i className="fa-solid fa-plus mr-1" />
                                    Add tracks
                                </button>
                                <button className="btn-ghost">
                                    <i className="fa-solid fa-share-nodes mr-1" />
                                    Share
                                </button>
                                <div className="relative" ref={exportRef}>
                                    <button
                                        className="btn-ghost"
                                        onClick={() => setExportOpen((o) => !o)}
                                    >
                                        <i className="fa-solid fa-download mr-1" />
                                        Export
                                        <i className="fa-solid fa-chevron-down ml-1.5 text-[10px] opacity-50" />
                                    </button>
                                    {exportOpen && (
                                        <div className="absolute left-0 top-full mt-1.5 min-w-[152px] bg-surface-high rounded-xl ring-1 ring-white/10 shadow-2xl z-10 p-1">
                                            <button
                                                onClick={() => { handleExport('markdown'); setExportOpen(false); }}
                                                className="w-full text-left px-3 py-1.5 text-sm text-on-surface-variant hover:bg-surface-high hover:text-on-surface transition-colors flex items-center gap-2 rounded-lg"
                                            >
                                                <i className="fa-solid fa-file-lines text-on-surface-variant" />
                                                Markdown
                                            </button>
                                            <button
                                                onClick={() => { handleExport('html'); setExportOpen(false); }}
                                                className="w-full text-left px-3 py-1.5 text-sm text-on-surface-variant hover:bg-surface-high hover:text-on-surface transition-colors flex items-center gap-2 rounded-lg"
                                            >
                                                <i className="fa-solid fa-file-code text-on-surface-variant" />
                                                HTML
                                            </button>
                                        </div>
                                    )}
                                </div>
                                {playlist.linkedSpotifyId && (
                                    <button
                                        onClick={syncNow}
                                        disabled={syncState === 'syncing'}
                                        className="btn-ghost"
                                        title="Pull latest changes from Spotify"
                                    >
                                        <i className={`fa-brands fa-spotify mr-1${syncState === 'syncing' ? ' animate-spin' : ''}`} />
                                        Sync
                                    </button>
                                )}
                            </div>
                            {playlist.linkedSpotifyId && syncState === 'done' && syncSummary && (
                                <p className="text-xs text-on-surface-variant mt-2">
                                    Synced {lastSynced?.toLocaleTimeString()} · +{syncSummary.added} added, {syncSummary.removed} removed
                                </p>
                            )}
                            {playlist.linkedSpotifyId && syncState === 'error' && (
                                <p className="text-xs text-error mt-2">Sync failed: {syncError}</p>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {/* Turn Management — always visible for all collaborative playlists (async session model) */}
            {playlist.isCollaborative && playlist.queueMode === 'turn_taking' && (
                <TurnManagementPanel
                    playlist={playlist}
                    participants={participants}
                    tracks={tracks}
                    totalDurationMs={totalDuration}
                    currentUserId={userId}
                />
            )}

            {/* First-open setup modal — shown when collaborative but turn-taking not yet configured */}
            {playlist.isCollaborative && !playlist.queueMode && (
                <TurnSetupModal playlist={playlist} participants={participants} />
            )}

            {/* Playlist Discussion */}
            <PlaylistComments playlistId={playlistId!} />

            {/* Track List */}
            <div className="card flex-1 overflow-hidden flex flex-col">
                <div className="card-header flex items-center justify-between">
                    <span className="font-medium">Tracks ({tracks.length})</span>
                </div>
                <div className="flex-1 overflow-y-auto">
                    {tracks.length === 0 ? (
                        <div className="text-center py-12 text-outline-variant">
                            <i className="fa-solid fa-music text-4xl mb-4" />
                            <p>No tracks yet</p>
                            <p className="text-sm mt-2">Import tracks from Spotify or add them manually</p>
                        </div>
                    ) : (
                        <table className="w-full">
                            <thead className="text-xs text-on-surface-variant uppercase border-b border-outline-variant">
                                <tr>
                                    <th className="text-left px-4 py-2 w-8">#</th>
                                    <th className="w-14"></th>
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
                                        <tr
                                    className="border-b border-outline-variant/50 hover:bg-surface-high/30 transition-colors"
                                    onContextMenu={(e) => openTrackMenu(e, buildTrackMenuItems(track))}
                                >
                                            <td className="px-4 py-3 text-on-surface-variant text-sm">{index + 1}</td>
                                            <td className="p-0 w-14">
                                                {artSrc(track.albumArtLocalPath, track.albumArtUrl) ? (
                                                    <img
                                                        src={artSrc(track.albumArtLocalPath, track.albumArtUrl)}
                                                        alt=""
                                                        className="w-14 h-14 object-cover block"
                                                        onError={(e) => {
                                                            if (track.albumArtUrl) e.currentTarget.src = track.albumArtUrl;
                                                        }}
                                                    />
                                                ) : (
                                                    <div className="w-14 h-14 bg-surface-high flex items-center justify-center">
                                                        <i className="fa-solid fa-music text-outline-variant text-sm" />
                                                    </div>
                                                )}
                                            </td>
                                            <td className="px-4 py-3">
                                                <div className="font-medium text-on-surface">{track.title}</div>
                                                <div className="text-sm text-on-surface-variant">{track.artists.join(', ')}</div>
                                                <ReactionBar trackId={track.id} playlistId={playlistId!} />
                                            </td>
                                            <td className="px-4 py-3 text-sm text-on-surface-variant">{track.album}</td>
                                            <td className="px-4 py-3 text-sm text-on-surface-variant">{track.addedByName ?? track.addedBy}</td>
                                            <td className="px-4 py-3 text-sm text-on-surface-variant text-right">
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
                                                                ? 'text-primary'
                                                                : 'text-on-surface-variant hover:text-on-surface'
                                                        }`}
                                                        title="Comments"
                                                    >
                                                        <i className="fa-solid fa-comment" />
                                                    </button>
                                                    <button
                                                        onClick={() => removeTrackFromPlaylist(playlistId!, track.id)}
                                                        className="text-outline-variant hover:text-error transition-colors"
                                                        title="Remove track"
                                                    >
                                                        <i className="fa-solid fa-xmark" />
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                        {expandedTrackComments === track.id && (
                                            <tr className="border-b border-outline-variant/50">
                                                <td colSpan={7} className="px-4 py-3 bg-surface/30">
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

            {trackMenuState.visible && (
                <ContextMenu
                    items={trackMenuState.items}
                    position={trackMenuState.position}
                    onClose={closeTrackMenu}
                />
            )}
        </div>
    );
}
