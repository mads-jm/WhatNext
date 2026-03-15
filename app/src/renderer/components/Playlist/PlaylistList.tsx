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
        () => db ? db.playlists.find().sort({ updatedAt: 'desc' }) : null,
        [db]
    );

    if (loading) {
        return (
            <div className="flex items-center justify-center py-12">
                <div className="text-gray-500 text-sm">Loading playlists...</div>
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
                    onContextMenu={(e) => openMenu(e, buildPlaylistMenuItems(playlist))}
                    className={`card w-full text-left cursor-pointer transition-colors ${
                        selectedPlaylistId === playlist.id
                            ? 'border-blue-500 bg-blue-950/20'
                            : 'hover:border-gray-600'
                    }`}
                >
                    <div className="card-body">
                        <div className="flex items-center gap-3">
                            <div className="w-12 h-12 rounded-md shrink-0 overflow-hidden bg-gradient-to-br from-blue-600 to-purple-600 flex items-center justify-center">
                                {(playlist.coverArtLocalPath || playlist.coverArtUrl) ? (
                                    <img
                                        src={artSrc(playlist.coverArtLocalPath, playlist.coverArtUrl)}
                                        alt=""
                                        className="w-full h-full object-cover"
                                        onError={(e) => {
                                            if (playlist.coverArtUrl) e.currentTarget.src = playlist.coverArtUrl;
                                        }}
                                    />
                                ) : (
                                    <i className="fa-solid fa-music text-white text-xs opacity-50" />
                                )}
                            </div>
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                    <h3 className="font-semibold text-gray-100 truncate">
                                        {playlist.playlistName}
                                    </h3>
                                    {playlist.isCollaborative && (
                                        <span className="badge-accent shrink-0">
                                            <i className="fa-solid fa-users text-xs mr-1" />
                                            Shared
                                        </span>
                                    )}
                                    {playlist.queueMode === 'turn_taking' && (
                                        <span className="px-1.5 py-0.5 bg-yellow-900/50 text-yellow-400 rounded text-[10px] font-semibold shrink-0">
                                            Turns
                                        </span>
                                    )}
                                </div>
                                {playlist.description && (
                                    <p className="text-xs text-gray-500 mt-0.5 truncate">
                                        {playlist.description}
                                    </p>
                                )}
                                <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
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
                        <i className="fa-solid fa-headphones text-4xl text-gray-700 mb-4" />
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
