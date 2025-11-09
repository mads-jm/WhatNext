interface Playlist {
    id: string;
    name: string;
    trackCount: number;
    updatedAt: string;
    isCollaborative?: boolean;
}

// Placeholder data for UI demonstration
const mockPlaylists: Playlist[] = [
    {
        id: '1',
        name: 'Summer Vibes 2024',
        trackCount: 42,
        updatedAt: '2 hours ago',
        isCollaborative: true,
    },
    {
        id: '2',
        name: 'Focus Flow',
        trackCount: 28,
        updatedAt: '1 day ago',
    },
    {
        id: '3',
        name: 'Late Night Coding',
        trackCount: 156,
        updatedAt: '3 days ago',
    },
];

interface PlaylistListProps {
    onPlaylistSelect?: (playlistId: string) => void;
}

export function PlaylistList({ onPlaylistSelect }: PlaylistListProps) {
    return (
        <div className="space-y-3">
            {mockPlaylists.map((playlist) => (
                <div
                    key={playlist.id}
                    onClick={() => onPlaylistSelect?.(playlist.id)}
                    className="card cursor-pointer hover:border-primary-600 transition-colors"
                >
                    <div className="card-body">
                        <div className="flex items-start justify-between">
                            <div className="flex-1">
                                <div className="flex items-center gap-2">
                                    <h3 className="font-semibold text-gray-100">
                                        {playlist.name}
                                    </h3>
                                    {playlist.isCollaborative && (
                                        <span className="badge-accent">
                                            <i className="fa-solid fa-users text-xs mr-1" />
                                            Shared
                                        </span>
                                    )}
                                </div>
                                <div className="flex items-center gap-3 mt-2 text-sm text-gray-500">
                                    <span>
                                        <i className="fa-solid fa-music mr-1.5" />
                                        {playlist.trackCount} tracks
                                    </span>
                                    <span>
                                        <i className="fa-solid fa-clock mr-1.5" />
                                        {playlist.updatedAt}
                                    </span>
                                </div>
                            </div>
                            <button className="btn-ghost text-xs">
                                <i className="fa-solid fa-ellipsis" />
                            </button>
                        </div>
                    </div>
                </div>
            ))}

            {/* Empty State */}
            {mockPlaylists.length === 0 && (
                <div className="card">
                    <div className="card-body text-center py-12">
                        <i className="fa-solid fa-list-music text-4xl text-gray-700 mb-4" />
                        <h3 className="text-lg font-medium text-gray-400 mb-2">
                            No Playlists Yet
                        </h3>
                        <p className="text-sm text-gray-600 mb-4">
                            Create your first playlist or import from Spotify
                        </p>
                        <button className="btn-primary">
                            <i className="fa-solid fa-plus" />
                            Create Playlist
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
