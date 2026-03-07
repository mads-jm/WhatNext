/**
 * SpotifyPlaylistBrowser — grid of Spotify playlists the user can import from.
 */

import type { SpotifyPlaylist } from '../../hooks/useSpotifyImport';

interface SpotifyPlaylistBrowserProps {
    playlists: SpotifyPlaylist[];
    browsing: boolean;
    onRefresh: () => void;
    onSelect: (playlist: SpotifyPlaylist) => void;
}

export function SpotifyPlaylistBrowser({ playlists, browsing, onRefresh, onSelect }: SpotifyPlaylistBrowserProps) {
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
                    onClick={onRefresh}
                    className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-lg text-sm transition-colors flex items-center gap-2"
                >
                    <i className="fa-solid fa-refresh" />
                    Refresh
                </button>
            </div>

            {/* Playlist Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {playlists.map((playlist) => (
                    <button
                        key={playlist.id}
                        onClick={() => onSelect(playlist)}
                        className="flex items-start gap-3 p-3 bg-gray-800 hover:bg-gray-700 rounded-lg transition-colors text-left group"
                    >
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
                        <div className="flex-1 min-w-0">
                            <h3 className="font-semibold text-gray-200 truncate group-hover:text-white transition-colors">
                                {playlist.name}
                            </h3>
                            <p className="text-xs text-gray-500 mt-0.5">{playlist.owner.display_name}</p>
                            <div className="flex items-center gap-2 mt-1.5">
                                <span className="text-xs text-gray-400">{playlist.tracks.total} tracks</span>
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
                        <i className="fa-solid fa-chevron-right text-gray-600 group-hover:text-gray-400 transition-colors mt-4" />
                    </button>
                ))}
            </div>

            {playlists.length === 0 && browsing && (
                <div className="text-center py-12 text-gray-500">
                    <i className="fa-solid fa-music text-3xl mb-3 block" />
                    <p>No playlists found on your Spotify account.</p>
                </div>
            )}
        </div>
    );
}
