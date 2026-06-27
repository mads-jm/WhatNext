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
                    className="p-2 hover:bg-surface-high rounded-lg transition-colors text-on-surface-variant hover:text-on-surface"
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
                        <h2 className="text-lg font-bold text-on-surface">{playlist.name}</h2>
                        <p className="text-sm text-on-surface-variant">
                            {playlist.tracks.total} tracks by {playlist.owner.display_name}
                        </p>
                    </div>
                </div>
            </div>

            {/* Loading tracks spinner */}
            {loading && (
                <div className="flex items-center justify-center py-12">
                    <div className="text-center">
                        <div className="w-10 h-10 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-3" />
                        <p className="text-on-surface-variant text-sm">Loading tracks...</p>
                    </div>
                </div>
            )}

            {/* Track list with selection */}
            {!loading && !importing && (
                <>
                    {/* Selection toolbar */}
                    <div className="flex items-center justify-between bg-surface-high rounded-lg px-4 py-3">
                        <div className="flex items-center gap-3">
                            <span className="text-sm text-on-surface">
                                <span className="text-primary font-semibold">{selectedTrackIds.size}</span> of{' '}
                                {tracks.length} selected
                            </span>
                            <div className="flex gap-2">
                                <button
                                    onClick={onSelectAll}
                                    className="text-xs px-2 py-1 bg-surface-high hover:bg-outline-variant text-on-surface rounded transition-colors"
                                >
                                    Select All
                                </button>
                                <button
                                    onClick={onSelectNone}
                                    className="text-xs px-2 py-1 bg-surface-high hover:bg-outline-variant text-on-surface rounded transition-colors"
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
                                    ? 'bg-primary hover:bg-primary-dim text-surface'
                                    : 'bg-surface-high text-on-surface-variant cursor-not-allowed'
                            }`}
                        >
                            <i className="fa-solid fa-download" />
                            Import {selectedTrackIds.size} Track{selectedTrackIds.size !== 1 ? 's' : ''}
                        </button>
                    </div>

                    {/* Track rows */}
                    <div className="bg-surface-high rounded-lg overflow-hidden">
                        <div className="grid grid-cols-12 gap-2 px-4 py-2 border-b border-outline-variant text-xs text-on-surface-variant uppercase tracking-wider">
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
                                    className={`w-full grid grid-cols-12 gap-2 px-4 py-2.5 text-left text-sm transition-colors border-b border-outline-variant/50 last:border-0 ${
                                        selectedTrackIds.has(track.id)
                                            ? 'bg-primary/10 hover:bg-primary/15'
                                            : 'hover:bg-surface-high/50'
                                    }`}
                                >
                                    <div className="col-span-1 flex items-center">
                                        <div
                                            className={`w-5 h-5 rounded border flex items-center justify-center text-xs ${
                                                selectedTrackIds.has(track.id)
                                                    ? 'bg-primary border-primary text-surface'
                                                    : 'border-outline-variant'
                                            }`}
                                        >
                                            {selectedTrackIds.has(track.id) ? (
                                                <i className="fa-solid fa-check" />
                                            ) : (
                                                <span className="text-on-surface-variant">{index + 1}</span>
                                            )}
                                        </div>
                                    </div>
                                    <div className="col-span-5 truncate text-on-surface">{track.title}</div>
                                    <div className="col-span-3 truncate text-on-surface-variant">{track.album}</div>
                                    <div className="col-span-2 truncate text-on-surface-variant">
                                        {track.artists.join(', ')}
                                    </div>
                                    <div className="col-span-1 text-right text-on-surface-variant">
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
                        <div className="w-10 h-10 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-3" />
                        <p className="text-on-surface-variant text-sm">Importing {selectedTrackIds.size} tracks...</p>
                    </div>
                </div>
            )}
        </div>
    );
}
