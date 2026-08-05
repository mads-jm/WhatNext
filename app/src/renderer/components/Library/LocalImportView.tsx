/**
 * LocalImportView — UI for importing audio files from the local filesystem.
 * Uses useLocalMediaImport state machine to drive the import flow.
 */

import { useState } from 'react';
import { useLocalMediaImport } from '../../hooks/useLocalMediaImport';
import { useNavigationStore } from '../../stores/navigation-store';
import { formatDuration } from '../../utils/format';

export function LocalImportView() {
    const navigate = useNavigationStore((s) => s.navigate);
    const {
        state,
        scannedTracks,
        selectedTrackIds,
        scanStats,
        importCount,
        createdPlaylistId,
        error,
        openDirectory,
        toggleTrack,
        selectAll,
        selectNone,
        importSelected,
        reset,
    } = useLocalMediaImport();

    const [playlistName, setPlaylistName] = useState('');
    const [createPlaylist, setCreatePlaylist] = useState(false);

    const handleImport = () => {
        importSelected(
            createPlaylist && playlistName.trim()
                ? playlistName.trim()
                : undefined,
        );
    };

    return (
        <div className="h-full flex flex-col">
            {/* Header */}
            <div className="card mb-4">
                <div className="card-body">
                    <div className="flex items-start justify-between gap-4">
                        <div>
                            <h2 className="text-2xl font-bold mb-1">
                                Import Local Files
                            </h2>
                            <p className="text-sm text-on-surface-variant">
                                Scan a folder on your computer and import audio
                                files into your WhatNext library.
                            </p>
                        </div>
                        {state === 'idle' && (
                            <button
                                onClick={openDirectory}
                                className="shrink-0 btn btn-primary flex items-center gap-2"
                            >
                                <i className="fa-solid fa-folder-open" />
                                Choose Folder
                            </button>
                        )}
                    </div>
                </div>
            </div>

            {/* State-driven content */}
            {state === 'idle' && (
                <div className="card flex-1 flex items-center justify-center">
                    <div className="text-center text-on-surface-variant py-16">
                        <i className="fa-solid fa-folder-open text-5xl mb-4" />
                        <h3 className="text-lg font-medium mb-2">
                            No folder selected
                        </h3>
                        <p className="text-sm max-w-xs mx-auto">
                            Click "Choose Folder" to scan a directory for audio
                            files.
                        </p>
                    </div>
                </div>
            )}

            {state === 'scanning' && (
                <div className="card flex-1 flex items-center justify-center">
                    <div className="text-center text-on-surface-variant py-16">
                        <i className="fa-solid fa-spinner fa-spin text-5xl mb-4" />
                        <h3 className="text-lg font-medium">Scanning…</h3>
                        <p className="text-sm mt-1">Looking for audio files</p>
                    </div>
                </div>
            )}

            {state === 'error' && (
                <div className="card flex-1 flex flex-col items-center justify-center gap-4">
                    <div className="text-center text-error py-8">
                        <i className="fa-solid fa-triangle-exclamation text-4xl mb-3" />
                        <h3 className="text-lg font-medium mb-1">
                            Something went wrong
                        </h3>
                        <p className="text-sm max-w-sm">{error}</p>
                    </div>
                    <button onClick={reset} className="btn btn-secondary">
                        Try Again
                    </button>
                </div>
            )}

            {state === 'selecting' && (
                <>
                    {/* Scan summary + controls */}
                    <div className="card mb-3">
                        <div className="card-body py-3">
                            <div className="flex items-center justify-between flex-wrap gap-3">
                                <div className="text-sm text-on-surface-variant">
                                    Found{' '}
                                    <span className="font-semibold text-on-surface">
                                        {scanStats?.supported ??
                                            scannedTracks.length}
                                    </span>{' '}
                                    audio file
                                    {scannedTracks.length !== 1 ? 's' : ''}
                                    {scanStats && (
                                        <span className="ml-2 text-xs">
                                            ({scanStats.skipped} skipped,{' '}
                                            {scanStats.scanned} total entries)
                                        </span>
                                    )}
                                </div>
                                <div className="flex items-center gap-2">
                                    <button
                                        onClick={selectAll}
                                        className="text-xs text-primary hover:underline"
                                    >
                                        Select all
                                    </button>
                                    <span className="text-on-surface-variant text-xs">
                                        ·
                                    </span>
                                    <button
                                        onClick={selectNone}
                                        className="text-xs text-primary hover:underline"
                                    >
                                        Select none
                                    </button>
                                    <span className="text-on-surface-variant text-xs ml-2">
                                        {selectedTrackIds.size} selected
                                    </span>
                                </div>
                            </div>

                            {/* Optional playlist creation */}
                            <div className="mt-3 flex items-center gap-3 flex-wrap">
                                <label className="flex items-center gap-2 text-sm cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={createPlaylist}
                                        onChange={(e) =>
                                            setCreatePlaylist(e.target.checked)
                                        }
                                        className="rounded"
                                    />
                                    Create a playlist from imported tracks
                                </label>
                                {createPlaylist && (
                                    <input
                                        type="text"
                                        placeholder="Playlist name…"
                                        value={playlistName}
                                        onChange={(e) =>
                                            setPlaylistName(e.target.value)
                                        }
                                        className="flex-1 min-w-[180px] px-3 py-1.5 bg-surface-high border border-outline-variant rounded-lg text-sm focus:outline-none focus:border-primary"
                                    />
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Track list */}
                    <div className="card flex-1 overflow-hidden flex flex-col">
                        <div className="flex-1 overflow-y-auto">
                            {scannedTracks.length === 0 ? (
                                <div className="text-center text-on-surface-variant py-12">
                                    <p className="text-sm">
                                        No supported audio files found in that
                                        folder.
                                    </p>
                                    <button
                                        onClick={reset}
                                        className="mt-3 text-primary text-sm hover:underline"
                                    >
                                        Try another folder
                                    </button>
                                </div>
                            ) : (
                                <table className="w-full">
                                    <thead className="sticky top-0 bg-surface text-xs text-on-surface-variant uppercase border-b border-outline-variant">
                                        <tr>
                                            <th className="px-4 py-2 w-8"></th>
                                            <th className="text-left px-4 py-2">
                                                Title
                                            </th>
                                            <th className="text-left px-4 py-2 hidden md:table-cell">
                                                Artist
                                            </th>
                                            <th className="text-left px-4 py-2 hidden lg:table-cell">
                                                Album
                                            </th>
                                            <th className="text-right px-4 py-2 w-16">
                                                Dur.
                                            </th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {scannedTracks.map((track) => (
                                            <tr
                                                key={track.id}
                                                onClick={() =>
                                                    toggleTrack(track.id)
                                                }
                                                className="border-b border-outline-variant/50 hover:bg-surface-high/30 transition-colors cursor-pointer"
                                            >
                                                <td className="px-4 py-2.5">
                                                    <input
                                                        type="checkbox"
                                                        checked={selectedTrackIds.has(
                                                            track.id,
                                                        )}
                                                        onChange={() =>
                                                            toggleTrack(
                                                                track.id,
                                                            )
                                                        }
                                                        onClick={(e) =>
                                                            e.stopPropagation()
                                                        }
                                                        className="rounded"
                                                    />
                                                </td>
                                                <td className="px-4 py-2.5">
                                                    <div className="font-medium text-on-surface truncate max-w-[200px]">
                                                        {track.title}
                                                    </div>
                                                </td>
                                                <td className="px-4 py-2.5 text-sm text-on-surface-variant hidden md:table-cell truncate max-w-[140px]">
                                                    {track.artists.join(', ') ||
                                                        '—'}
                                                </td>
                                                <td className="px-4 py-2.5 text-sm text-on-surface-variant hidden lg:table-cell truncate max-w-[140px]">
                                                    {track.album}
                                                </td>
                                                <td className="px-4 py-2.5 text-right text-sm text-on-surface-variant tabular-nums">
                                                    {track.durationMs > 0
                                                        ? formatDuration(
                                                              track.durationMs,
                                                          )
                                                        : '—'}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            )}
                        </div>

                        {/* Import action */}
                        {scannedTracks.length > 0 && (
                            <div className="card-footer flex items-center justify-between gap-3 border-t border-outline-variant px-4 py-3">
                                <button
                                    onClick={reset}
                                    className="text-sm text-on-surface-variant hover:text-on-surface"
                                >
                                    <i className="fa-solid fa-arrow-left mr-1.5" />
                                    Choose different folder
                                </button>
                                <button
                                    onClick={handleImport}
                                    disabled={selectedTrackIds.size === 0}
                                    className="btn btn-primary disabled:opacity-50"
                                >
                                    Import {selectedTrackIds.size} track
                                    {selectedTrackIds.size !== 1 ? 's' : ''}
                                </button>
                            </div>
                        )}
                    </div>
                </>
            )}

            {state === 'importing' && (
                <div className="card flex-1 flex items-center justify-center">
                    <div className="text-center text-on-surface-variant py-16">
                        <i className="fa-solid fa-spinner fa-spin text-5xl mb-4 text-primary" />
                        <h3 className="text-lg font-medium">Importing…</h3>
                        <p className="text-sm mt-1">
                            Writing tracks to your library
                        </p>
                    </div>
                </div>
            )}

            {state === 'done' && (
                <div className="card flex-1 flex flex-col items-center justify-center gap-4">
                    <div className="text-center py-8">
                        <i className="fa-solid fa-circle-check text-5xl mb-3 text-primary" />
                        <h3 className="text-lg font-medium mb-1">
                            {importCount} track{importCount !== 1 ? 's' : ''}{' '}
                            imported
                        </h3>
                        {createdPlaylistId && (
                            <p className="text-sm text-on-surface-variant">
                                A playlist was created with your tracks.
                            </p>
                        )}
                    </div>
                    <div className="flex gap-3">
                        <button onClick={reset} className="btn btn-secondary">
                            Import More
                        </button>
                        <button
                            onClick={() => navigate('library')}
                            className="btn btn-primary"
                        >
                            View Library
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
