/**
 * useLocalMediaImport — state machine for the local file import flow.
 *
 * State machine:
 *   idle → scanning → selecting → importing → done
 *                                           ↘ error (from any state)
 *
 * Flow:
 *   1. User opens a directory picker via openDirectory
 *   2. main process scans directory via media:scan-directory IPC
 *   3. User selects which tracks to import
 *   4. bulkImportTracks writes to RxDB; optionally createPlaylist
 */

import { useState, useCallback } from 'react';
import { useUserStore } from '../stores/user-store';
import { bulkImportTracks } from '../db/services/track-service';
import {
    createPlaylist,
    bulkAddTracksToPlaylist,
} from '../db/services/playlist-service';
import type { ScanDirectoryTrack } from '../../shared/core/ipc-protocol';

export type LocalImportState =
    'idle' | 'scanning' | 'selecting' | 'importing' | 'done' | 'error';

export function useLocalMediaImport() {
    const userId = useUserStore((s) => s.userId);

    const [state, setState] = useState<LocalImportState>('idle');
    const [scannedTracks, setScannedTracks] = useState<ScanDirectoryTrack[]>(
        [],
    );
    const [selectedTrackIds, setSelectedTrackIds] = useState<Set<string>>(
        new Set(),
    );
    const [scanStats, setScanStats] = useState<{
        scanned: number;
        supported: number;
        skipped: number;
    } | null>(null);
    const [importCount, setImportCount] = useState(0);
    const [createdPlaylistId, setCreatedPlaylistId] = useState<string | null>(
        null,
    );
    const [error, setError] = useState<string | null>(null);

    /**
     * Open a native directory picker, then scan the chosen directory.
     */
    const openDirectory = useCallback(async () => {
        setError(null);
        try {
            const result = await window.electron?.dialog.openDirectory({
                title: 'Select Music Folder',
                properties: ['openDirectory'],
            });

            if (!result || result.canceled || result.filePaths.length === 0) {
                return; // User cancelled — stay idle
            }

            const dirPath = result.filePaths[0];
            setState('scanning');

            const scanResult =
                await window.electron?.media.scanDirectory(dirPath);

            if (!scanResult?.success) {
                setError(scanResult?.error ?? 'Scan failed');
                setState('error');
                return;
            }

            const tracks = scanResult.tracks ?? [];
            setScannedTracks(tracks);
            setScanStats(scanResult.stats ?? null);
            setSelectedTrackIds(new Set(tracks.map((t) => t.id)));
            setState('selecting');
        } catch (err) {
            setError(`Failed to scan directory: ${err}`);
            setState('error');
        }
    }, []);

    const toggleTrack = useCallback((trackId: string) => {
        setSelectedTrackIds((prev) => {
            const next = new Set(prev);
            if (next.has(trackId)) {
                next.delete(trackId);
            } else {
                next.add(trackId);
            }
            return next;
        });
    }, []);

    const selectAll = useCallback(
        () => setSelectedTrackIds(new Set(scannedTracks.map((t) => t.id))),
        [scannedTracks],
    );

    const selectNone = useCallback(() => setSelectedTrackIds(new Set()), []);

    /**
     * Import selected tracks into RxDB, optionally creating a playlist.
     * @param playlistName - If provided, creates a new playlist with the imported tracks.
     */
    const importSelected = useCallback(
        async (playlistName?: string) => {
            setState('importing');
            setError(null);
            try {
                const tracksToImport = scannedTracks.filter((t) =>
                    selectedTrackIds.has(t.id),
                );

                const trackIds = await bulkImportTracks(
                    tracksToImport.map((t) => ({
                        title: t.title,
                        artists: t.artists,
                        album: t.album,
                        durationMs: t.durationMs,
                        localFilePath: t.localFilePath,
                        localFileSize: t.localFileSize,
                        source: t.source,
                        audioFormat: t.audioFormat,
                        audioBitrate: t.audioBitrate,
                        addedBy: userId,
                        addedAt: t.addedAt,
                    })),
                );

                let playlistId: string | null = null;
                if (playlistName) {
                    const playlist = await createPlaylist({
                        playlistName,
                        ownerId: userId,
                        tags: ['local'],
                        isCollaborative: false,
                        isPublic: false,
                    });
                    await bulkAddTracksToPlaylist(playlist.id, trackIds);
                    playlistId = playlist.id;
                }

                setImportCount(tracksToImport.length);
                setCreatedPlaylistId(playlistId);
                setState('done');
            } catch (err) {
                setError(`Import failed: ${err}`);
                setState('error');
            }
        },
        [scannedTracks, selectedTrackIds, userId],
    );

    const reset = useCallback(() => {
        setScannedTracks([]);
        setSelectedTrackIds(new Set());
        setScanStats(null);
        setImportCount(0);
        setCreatedPlaylistId(null);
        setError(null);
        setState('idle');
    }, []);

    return {
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
    };
}
