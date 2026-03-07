/**
 * SpotifyTrackSelector — track list with checkboxes + import button.
 * Handles selecting/loading-tracks/importing sub-states.
 */

import { formatDuration } from '../../utils/format';
import type { SpotifyPlaylist, MappedTrack } from '../../hooks/useSpotifyImport';

interface SpotifyTrackSelectorProps {
    playlist: SpotifyPlaylist;
    tracks: MappedTrack[];
    selectedTrackIds: Set<string>;
    loading: boolean;
    importing: boolean;
    onToggleTrack: (id: string) => void;
    onSelectAll: () => void;
    onSelectNone: () => void;
    onImport: () => void;
    onBack: () => void;
}

export function SpotifyTrackSelector({
    playlist,
    tracks,
    selectedTrackIds,
    loading,
    importing,
    onToggleTrack,
    onSelectAll,
    onSelectNone,
    onImport,
    onBack,
}: SpotifyTrackSelectorProps) {
    return (
        <div className="space-y-4">
            {/* Header */}
            <div className="flex items-center gap-4">
                <button
                    onClick={onBack}
                    className="p-2 hover:bg-gray-700 rounded-lg transition-colors text-gray-400 hover:text-gray-200"
                >
                    <i className="fa-solid fa-arrow-left" />
                </button>
                <div className="flex items-center gap-3 flex-1">
                    {playlist.images?.[0] && (
                        <img
                            src={playlist.images[0].url}
                            alt={playlist.name}
                            className="w-12 h-12 rounded-md object-cover"
                        />
                    )}
                    <div>
                        <h2 className="text-lg font-bold text-gray-100">{playlist.name}</h2>
                        <p className="text-sm text-gray-400">
                            {playlist.tracks.total} tracks by {playlist.owner.display_name}
                        </p>
                    </div>
                </div>
            </div>

            {/* Loading tracks spinner */}
            {loading && (
                <div className="flex items-center justify-center py-12">
                    <div className="text-center">
                        <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
                        <p className="text-gray-400 text-sm">Loading tracks...</p>
                    </div>
                </div>
            )}

            {/* Track list with selection */}
            {!loading && !importing && (
                <>
                    {/* Selection toolbar */}
                    <div className="flex items-center justify-between bg-gray-800 rounded-lg px-4 py-3">
                        <div className="flex items-center gap-3">
                            <span className="text-sm text-gray-300">
                                <span className="text-blue-400 font-semibold">{selectedTrackIds.size}</span> of{' '}
                                {tracks.length} selected
                            </span>
                            <div className="flex gap-2">
                                <button
                                    onClick={onSelectAll}
                                    className="text-xs px-2 py-1 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded transition-colors"
                                >
                                    Select All
                                </button>
                                <button
                                    onClick={onSelectNone}
                                    className="text-xs px-2 py-1 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded transition-colors"
                                >
                                    Select None
                                </button>
                            </div>
                        </div>
                        <button
                            onClick={onImport}
                            disabled={selectedTrackIds.size === 0}
                            className={`px-4 py-2 rounded-lg font-semibold text-sm transition-colors flex items-center gap-2 ${
                                selectedTrackIds.size > 0
                                    ? 'bg-green-600 hover:bg-green-500 text-white'
                                    : 'bg-gray-700 text-gray-500 cursor-not-allowed'
                            }`}
                        >
                            <i className="fa-solid fa-download" />
                            Import {selectedTrackIds.size} Track{selectedTrackIds.size !== 1 ? 's' : ''}
                        </button>
                    </div>

                    {/* Track rows */}
                    <div className="bg-gray-800 rounded-lg overflow-hidden">
                        <div className="grid grid-cols-12 gap-2 px-4 py-2 border-b border-gray-700 text-xs text-gray-500 uppercase tracking-wider">
                            <div className="col-span-1">#</div>
                            <div className="col-span-5">Title</div>
                            <div className="col-span-3">Album</div>
                            <div className="col-span-2">Artists</div>
                            <div className="col-span-1 text-right">Duration</div>
                        </div>
                        <div className="max-h-[500px] overflow-y-auto">
                            {tracks.map((track, index) => (
                                <button
                                    key={track.id}
                                    onClick={() => onToggleTrack(track.id)}
                                    className={`w-full grid grid-cols-12 gap-2 px-4 py-2.5 text-left text-sm transition-colors border-b border-gray-700/50 last:border-0 ${
                                        selectedTrackIds.has(track.id)
                                            ? 'bg-blue-900/20 hover:bg-blue-900/30'
                                            : 'hover:bg-gray-700/50'
                                    }`}
                                >
                                    <div className="col-span-1 flex items-center">
                                        <div
                                            className={`w-5 h-5 rounded border flex items-center justify-center text-xs ${
                                                selectedTrackIds.has(track.id)
                                                    ? 'bg-blue-600 border-blue-600 text-white'
                                                    : 'border-gray-600'
                                            }`}
                                        >
                                            {selectedTrackIds.has(track.id) ? (
                                                <i className="fa-solid fa-check" />
                                            ) : (
                                                <span className="text-gray-500">{index + 1}</span>
                                            )}
                                        </div>
                                    </div>
                                    <div className="col-span-5 truncate text-gray-200">{track.title}</div>
                                    <div className="col-span-3 truncate text-gray-400">{track.album}</div>
                                    <div className="col-span-2 truncate text-gray-400">
                                        {track.artists.join(', ')}
                                    </div>
                                    <div className="col-span-1 text-right text-gray-500">
                                        {formatDuration(track.durationMs)}
                                    </div>
                                </button>
                            ))}
                        </div>
                    </div>
                </>
            )}

            {/* Importing spinner */}
            {importing && (
                <div className="flex items-center justify-center py-12">
                    <div className="text-center">
                        <div className="w-10 h-10 border-4 border-green-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
                        <p className="text-gray-400 text-sm">Importing {selectedTrackIds.size} tracks...</p>
                    </div>
                </div>
            )}
        </div>
    );
}
