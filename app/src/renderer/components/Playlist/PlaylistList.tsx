import { useRxDBQuery } from '../../hooks/useRxDBCollection';
import { useDatabase } from '../../hooks/useDatabase';
import { useNavigationStore } from '../../stores/navigation-store';
import { formatTimeAgo } from '../../utils/format';
import { artSrc } from '../../utils/artSrc';
import type { PlaylistDocType } from '../../db/schemas';
import { deletePlaylist } from '../../db/services/playlist-service';
import { exportAndSave } from '../../services/export/export-service';
import { ContextMenu, type ContextMenuItem } from '../shared/ContextMenu';
import { useContextMenu } from '../../hooks/useContextMenu';

function buildPlaylistMenuItems(playlist: PlaylistDocType): ContextMenuItem[] {
    return [
        {
            id: 'quick-export',
            label: 'Quick Export',
            icon: 'fa-solid fa-download',
            subItems: [
                {
                    id: 'export-md',
                    label: 'Markdown',
                    icon: 'fa-solid fa-file-lines',
                    action: () => exportAndSave(playlist.id, 'markdown'),
                },
                {
                    id: 'export-html',
                    label: 'HTML',
                    icon: 'fa-solid fa-file-code',
                    action: () => exportAndSave(playlist.id, 'html'),
                },
            ],
        },
        { separator: true },
        {
            id: 'delete',
            label: 'Delete Playlist',
            icon: 'fa-solid fa-trash',
            variant: 'danger',
            requiresConfirm: true,
            confirmLabel: `Delete "${playlist.playlistName}"?`,
            action: () => deletePlaylist(playlist.id),
        },
    ];
}

export function PlaylistList() {
    const { db } = useDatabase();
    const selectedPlaylistId = useNavigationStore((s) => s.selectedPlaylistId);
    const selectPlaylist = useNavigationStore((s) => s.selectPlaylist);
    const openCreateDialog = useNavigationStore((s) => s.openCreateDialog);
    const { menuState, openMenu, closeMenu } = useContextMenu();

    const { data: playlists, loading } = useRxDBQuery<PlaylistDocType>(
        () => (db ? db.playlists.find().sort({ updatedAt: 'desc' }) : null),
        [db],
    );

    if (loading) {
        return (
            <div className="flex items-center justify-center py-12">
                <div className="text-on-surface-variant text-sm">
                    Loading playlists...
                </div>
            </div>
        );
    }

    return (
        <>
            <div className="space-y-3">
                {/* Create Playlist Button */}
                <button
                    onClick={openCreateDialog}
                    className="w-full btn-primary flex items-center justify-center gap-2 py-3"
                >
                    <i className="fa-solid fa-plus" />
                    Create Playlist
                </button>

                {/* Playlist Cards */}
                {playlists.map((playlist) => (
                    <button
                        key={playlist.id}
                        onClick={() => selectPlaylist(playlist.id)}
                        onContextMenu={(e) =>
                            openMenu(e, buildPlaylistMenuItems(playlist))
                        }
                        className={`card w-full text-left cursor-pointer transition-colors ${
                            selectedPlaylistId === playlist.id
                                ? 'border-primary bg-primary/10'
                                : 'hover:border-outline-variant'
                        }`}
                    >
                        <div className="card-body">
                            <div className="flex items-center gap-3">
                                <div className="w-12 h-12 rounded-md shrink-0 overflow-hidden bg-gradient-to-br from-primary-dim to-primary flex items-center justify-center">
                                    {playlist.coverArtLocalPath ||
                                    playlist.coverArtUrl ? (
                                        <img
                                            src={artSrc(
                                                playlist.coverArtLocalPath,
                                                playlist.coverArtUrl,
                                            )}
                                            alt=""
                                            className="w-full h-full object-cover"
                                            onError={(e) => {
                                                if (playlist.coverArtUrl)
                                                    e.currentTarget.src =
                                                        playlist.coverArtUrl;
                                            }}
                                        />
                                    ) : (
                                        <i className="fa-solid fa-music text-on-surface text-xs opacity-50" />
                                    )}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2">
                                        <h3 className="font-semibold text-on-surface truncate">
                                            {playlist.playlistName}
                                        </h3>
                                        {playlist.isCollaborative && (
                                            <span className="badge-accent shrink-0">
                                                <i className="fa-solid fa-users text-xs mr-1" />
                                                Shared
                                            </span>
                                        )}
                                        {playlist.queueMode ===
                                            'turn_taking' && (
                                            <span className="px-1.5 py-0.5 bg-secondary/15 text-secondary rounded text-[10px] font-semibold shrink-0">
                                                Turns
                                            </span>
                                        )}
                                    </div>
                                    {playlist.description && (
                                        <p className="text-xs text-on-surface-variant mt-0.5 truncate">
                                            {playlist.description}
                                        </p>
                                    )}
                                    <div className="flex items-center gap-3 mt-1 text-xs text-on-surface-variant">
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
                    </button>
                ))}

                {/* Empty State */}
                {playlists.length === 0 && (
                    <div className="card">
                        <div className="card-body text-center py-12">
                            <i className="fa-solid fa-headphones text-4xl text-outline-variant mb-4" />
                            <h3 className="text-lg font-medium text-on-surface-variant mb-2">
                                No Playlists Yet
                            </h3>
                            <p className="text-sm text-outline-variant mb-4">
                                Create your first playlist to get started
                            </p>
                        </div>
                    </div>
                )}
            </div>
            {menuState.visible && (
                <ContextMenu
                    items={menuState.items}
                    position={menuState.position}
                    onClose={closeMenu}
                />
            )}
        </>
    );
}
