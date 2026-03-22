/**
 * SpotifyImportComplete — success screen after a Spotify import.
 */

import type { SpotifyPlaylist } from '../../hooks/useSpotifyImport';

interface SpotifyImportCompleteProps {
    importCount: number;
    selectedPlaylist: SpotifyPlaylist | null;
    createdPlaylistId: string | null;
    onImportMore: () => void;
    onGoToPlaylist: (id: string) => void;
    onDone: () => void;
}

export function SpotifyImportComplete({
    importCount,
    selectedPlaylist,
    createdPlaylistId,
    onImportMore,
    onGoToPlaylist,
    onDone,
}: SpotifyImportCompleteProps) {
    return (
        <div className="flex items-center justify-center min-h-[400px]">
            <div className="text-center max-w-md">
                <div className="w-16 h-16 bg-primary rounded-full flex items-center justify-center mx-auto mb-6">
                    <i className="fa-solid fa-check text-surface text-2xl" />
                </div>
                <h2 className="text-2xl font-bold text-on-surface mb-3">Playlist Created!</h2>
                <p className="text-on-surface-variant mb-2">
                    Imported <span className="text-primary font-semibold">{importCount}</span> tracks
                    {selectedPlaylist && (
                        <>
                            {' '}
                            from <span className="text-on-surface font-medium">{selectedPlaylist.name}</span>
                        </>
                    )}{' '}
                    into your Library.
                </p>
                <p className="text-xs text-on-surface-variant mb-6">
                    Local playlist · Linked to Spotify · Accessory Mode
                </p>
                <div className="flex gap-3 justify-center flex-wrap">
                    <button
                        onClick={onImportMore}
                        className="px-4 py-2 bg-surface-high hover:bg-outline-variant text-on-surface rounded-lg transition-colors"
                    >
                        Import More
                    </button>
                    {createdPlaylistId && (
                        <button
                            onClick={() => onGoToPlaylist(createdPlaylistId)}
                            className="px-4 py-2 bg-primary hover:bg-primary-dim text-surface rounded-lg transition-colors flex items-center gap-2"
                        >
                            <i className="fa-solid fa-headphones" />
                            Go to Playlist
                        </button>
                    )}
                    <button
                        onClick={onDone}
                        className="px-4 py-2 bg-surface-high hover:bg-outline-variant text-on-surface rounded-lg transition-colors"
                    >
                        Done
                    </button>
                </div>
            </div>
        </div>
    );
}
