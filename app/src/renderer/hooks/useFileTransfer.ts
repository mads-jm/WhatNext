/**
 * useFileTransfer
 *
 * Wires the renderer to the file transfer preload API.
 *
 * Responsibilities:
 *  - Subscribe to IPC events on mount, clean up on unmount
 *  - Throttle progress updates to max 10 per second per transfer (100ms gate)
 *  - Expose action functions that call the preload API and sync store state
 *  - Track peer capabilities from handshake events
 */

import { useEffect, useRef, useMemo } from 'react';
import { useFileTransferStore } from '../stores/file-transfer-store';
import { FILE_TRANSFER_CAPABILITY } from '../../shared/core/file-transfer-types';
import type {
    FileEntry,
    ActiveTransfer,
} from '../../shared/core/file-transfer-types';

// Maximum progress update rate per transfer (ms between store writes)
const PROGRESS_THROTTLE_MS = 100;

// ============================================================
// Primary hook — mounts IPC listeners and exposes actions
// ============================================================

export function useFileTransfer() {
    const store = useFileTransferStore();

    // Per-sha256 last-update timestamps for throttling
    const lastProgressUpdate = useRef<Map<string, number>>(new Map());

    useEffect(() => {
        const ft = window.electron?.fileTransfer;
        const p2p = window.electron?.p2p;
        if (!ft) return;

        const cleanups: Array<() => void> = [];

        // ---- onManifest ----
        const removeManifest = ft.onManifest((manifest) => {
            store.setManifest(manifest.playlistId, manifest);
        });
        cleanups.push(removeManifest);

        // ---- onProgress (throttled per sha256) ----
        const removeProgress = ft.onProgress((progress) => {
            const now = Date.now();
            const last = lastProgressUpdate.current.get(progress.sha256) ?? 0;
            if (now - last < PROGRESS_THROTTLE_MS) return;
            lastProgressUpdate.current.set(progress.sha256, now);

            store.updateTransfer(progress.sha256, {
                bytesReceived: progress.bytesReceived,
                totalBytes: progress.totalBytes,
                status: 'transferring',
            });
        });
        cleanups.push(removeProgress);

        // ---- onComplete ----
        const removeComplete = ft.onComplete((result) => {
            lastProgressUpdate.current.delete(result.sha256);
            store.updateTransfer(result.sha256, {
                status: 'complete',
                bytesReceived:
                    store.transfers.get(result.sha256)?.totalBytes ??
                    store.transfers.get(result.sha256)?.bytesReceived ??
                    0,
                // Store localFilePath by patching the transfer.
                // ActiveTransfer doesn't have localFilePath in the shared type —
                // we annotate it via a cast so consuming components can access it.
                ...(result.localFilePath
                    ? { localFilePath: result.localFilePath }
                    : {}),
            } as Partial<ActiveTransfer>);
        });
        cleanups.push(removeComplete);

        // ---- onError ----
        const removeError = ft.onError((err) => {
            lastProgressUpdate.current.delete(err.sha256);
            store.updateTransfer(err.sha256, {
                status: 'error',
                error: err.error,
            });
        });
        cleanups.push(removeError);

        // ---- onHandshakeComplete — populate peer capabilities ----
        if (p2p) {
            const removeHandshake = p2p.onHandshakeComplete((data) => {
                store.setPeerCapabilities(data.peerId, data.capabilities);
            });
            cleanups.push(removeHandshake);
        }

        return () => {
            cleanups.forEach((fn) => fn());
        };
        // store actions are stable (Zustand guarantees); no deps needed.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // ============================================================
    // Action: request a manifest from a remote peer
    // ============================================================
    const requestManifest = async (
        peerId: string,
        playlistId: string,
    ): Promise<void> => {
        await window.electron?.fileTransfer?.requestManifest(
            peerId,
            playlistId,
        );
    };

    // ============================================================
    // Action: initiate file downloads from a remote peer
    // ============================================================
    const requestFiles = async (
        peerId: string,
        files: FileEntry[],
    ): Promise<void> => {
        if (!files.length) return;

        const now = new Date().toISOString();

        // Seed the store with pending entries so the UI can show them immediately
        for (const file of files) {
            store.updateTransfer(file.sha256, {
                sha256: file.sha256,
                trackId: file.trackId,
                type: file.type,
                filename: file.filename,
                totalBytes: file.sizeBytes,
                bytesReceived: 0,
                status: 'pending',
                peerId,
                startedAt: now,
            });
        }

        await window.electron?.fileTransfer?.requestFiles(peerId, files);
    };

    // ============================================================
    // Action: cancel a single transfer
    // ============================================================
    const cancelTransfer = async (sha256: string): Promise<void> => {
        store.updateTransfer(sha256, { status: 'cancelled' });
        await window.electron?.fileTransfer?.cancel(sha256);
    };

    // ============================================================
    // Action: enable/disable sharing for a playlist
    // ============================================================
    const setSharing = async (
        playlistId: string,
        enabled: boolean,
    ): Promise<void> => {
        store.setSharingEnabled(playlistId, enabled);
        await window.electron?.fileTransfer?.setSharing(playlistId, enabled);
    };

    // ============================================================
    // Action: register local tracks with the sharing layer
    // ============================================================
    const registerTracks = async (
        playlistId: string,
        coverArtPath: string | undefined,
        tracks: Array<{
            trackId: string;
            audioPath?: string;
            artworkPath?: string;
        }>,
    ): Promise<void> => {
        await window.electron?.fileTransfer?.registerTracks(
            playlistId,
            coverArtPath,
            tracks,
        );
    };

    return {
        // State
        transfers: store.transfers,
        manifests: store.manifests,
        sharingEnabled: store.sharingEnabled,
        peerCapabilities: store.peerCapabilities,

        // Store helpers
        clearPlaylistTransfers: store.clearPlaylistTransfers,
        removeTransfer: store.removeTransfer,

        // IPC actions
        requestManifest,
        requestFiles,
        cancelTransfer,
        setSharing,
        registerTracks,
    };
}

// ============================================================
// Derived hook — aggregate transfer status
// ============================================================

export interface FileTransferStatus {
    totalFiles: number;
    completedFiles: number;
    activeDownloads: number;
    totalBytes: number;
    bytesReceived: number;
    overallBps: number;
    hasErrors: boolean;
}

/**
 * Returns aggregated transfer metrics.
 * When playlistId is provided, scopes to transfers whose trackId matches tracks
 * in that playlist's manifest. Without playlistId, aggregates all transfers.
 */
export function useFileTransferStatus(playlistId?: string): FileTransferStatus {
    const transfers = useFileTransferStore((s) => s.transfers);
    const manifests = useFileTransferStore((s) => s.manifests);

    return useMemo(() => {
        let relevantTransfers: ActiveTransfer[];

        if (playlistId) {
            const manifest = manifests.get(playlistId);
            const trackIds = manifest
                ? new Set(manifest.files.map((f) => f.trackId))
                : new Set<string>();
            // Always include the playlistId itself (cover-art transfer key)
            trackIds.add(playlistId);

            relevantTransfers = [];
            for (const t of transfers.values()) {
                if (trackIds.has(t.trackId)) {
                    relevantTransfers.push(t);
                }
            }
        } else {
            relevantTransfers = [...transfers.values()];
        }

        let totalBytes = 0;
        let bytesReceived = 0;
        const overallBps = 0;
        let completedFiles = 0;
        let activeDownloads = 0;
        let hasErrors = false;

        for (const t of relevantTransfers) {
            totalBytes += t.totalBytes;
            bytesReceived += t.bytesReceived;
            if (t.status === 'complete') completedFiles++;
            if (
                t.status === 'transferring' ||
                t.status === 'pending' ||
                t.status === 'verifying'
            ) {
                activeDownloads++;
            }
            if (t.status === 'error') hasErrors = true;

            // bytesPerSecond is on TransferProgress events, not on ActiveTransfer.
            // We can't directly access it here — overallBps stays 0 unless we extend
            // the store. Acceptable for now; UI can derive from timestamp if needed.
        }

        return {
            totalFiles: relevantTransfers.length,
            completedFiles,
            activeDownloads,
            totalBytes,
            bytesReceived,
            overallBps,
            hasErrors,
        };
    }, [transfers, manifests, playlistId]);
}

// ============================================================
// Capability check hook
// ============================================================

/**
 * Returns true if the peer advertised file-transfer/1.0.0 during handshake.
 */
export function usePeerFileCapability(peerId: string): boolean {
    return useFileTransferStore((s) => {
        const caps = s.peerCapabilities.get(peerId);
        return caps ? caps.includes(FILE_TRANSFER_CAPABILITY) : false;
    });
}
