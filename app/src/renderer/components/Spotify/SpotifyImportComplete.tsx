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
                <div className="w-16 h-16 bg-green-600 rounded-full flex items-center justify-center mx-auto mb-6">
                    <i className="fa-solid fa-check text-white text-2xl" />
                </div>
                <h2 className="text-2xl font-bold text-gray-100 mb-3">Playlist Created!</h2>
                <p className="text-gray-400 mb-2">
                    Imported <span className="text-green-400 font-semibold">{importCount}</span> tracks
                    {selectedPlaylist && (
                        <>
                            {' '}
                            from <span className="text-gray-200 font-medium">{selectedPlaylist.name}</span>
                        </>
                    )}{' '}
                    into your Library.
                </p>
                <p className="text-xs text-gray-500 mb-6">
                    Local playlist · Linked to Spotify · Accessory Mode
                </p>
                <div className="flex gap-3 justify-center flex-wrap">
                    <button
                        onClick={onImportMore}
                        className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded-lg transition-colors"
                    >
                        Import More
                    </button>
                    {createdPlaylistId && (
                        <button
                            onClick={() => onGoToPlaylist(createdPlaylistId)}
                            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors flex items-center gap-2"
                        >
                            <i className="fa-solid fa-headphones" />
                            Go to Playlist
                        </button>
                    )}
                    <button
                        onClick={onDone}
                        className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded-lg transition-colors"
                    >
                        Done
                    </button>
                </div>
            </div>
        </div>
    );
}
