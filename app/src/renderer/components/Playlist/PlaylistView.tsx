/**
 * Detailed view for a single playlist
 * Placeholder for future track management UI
 */
export function PlaylistView({ playlistId }: { playlistId?: string }) {
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

    return (
        <div className="h-full flex flex-col">
            {/* Playlist Header */}
            <div className="card mb-4">
                <div className="card-body">
                    <div className="flex items-start gap-4">
                        {/* Playlist Cover Placeholder */}
                        <div className="w-32 h-32 rounded-lg bg-gradient-to-br from-primary-600 to-accent-600 flex items-center justify-center">
                            <i className="fa-solid fa-music text-4xl text-white opacity-50" />
                        </div>

                        {/* Playlist Info */}
                        <div className="flex-1">
                            <span className="badge-muted mb-2">Playlist</span>
                            <h2 className="text-3xl font-bold mb-2">
                                Playlist Name
                            </h2>
                            <p className="text-sm text-gray-500 mb-4">
                                42 tracks • 2h 34m • Updated 2 hours ago
                            </p>
                            <div className="flex gap-2">
                                <button className="btn-primary">
                                    <i className="fa-solid fa-play" />
                                    Play
                                </button>
                                <button className="btn-ghost">
                                    <i className="fa-solid fa-share-nodes" />
                                    Share
                                </button>
                                <button className="btn-ghost">
                                    <i className="fa-solid fa-ellipsis" />
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Track List Placeholder */}
            <div className="card flex-1">
                <div className="card-header">
                    <span className="font-medium">Tracks</span>
                </div>
                <div className="card-body">
                    <div className="text-center py-12 text-gray-600">
                        <i className="fa-solid fa-music text-4xl mb-4" />
                        <p>Track list will appear here</p>
                        <p className="text-sm mt-2">
                            Driven by RxDB queries in the future
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
}
