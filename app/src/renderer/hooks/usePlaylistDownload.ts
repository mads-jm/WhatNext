/**
 * usePlaylistDownload — state machine for the URL-based download flow.
 *
 * State machine:
 *   idle → checking → resolving → selecting → downloading → done
 *                                                          ↘ error (from any state)
 *
 * Flow:
 *   1. On mount, check installed backends
 *   2. User pastes a URL and submits
 *   3. Resolve URL → ResolvedTrack[] via download:resolve IPC
 *   4. User selects tracks + preferred format
 *   5. Start download via download:start IPC
 *   6. Listen to progress/complete/error events
 *   7. On completion, import completed tracks into RxDB
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { useUserStore } from '../stores/user-store';
import { bulkImportTracks, updateTrack } from '../db/services/track-service';
import type { BackendStatusResult } from '../../shared/core/ipc-protocol';
import type { ResolvedTrack, DownloadEvent } from '../../../../service/downloader/types';

export type DownloadState =
    | 'idle'
    | 'checking'
    | 'resolving'
    | 'selecting'
    | 'downloading'
    | 'done'
    | 'error';

export interface TrackProgress {
    sourceUrl: string;
    percent: number;
    speed?: string;
    eta?: string;
    status: 'pending' | 'downloading' | 'complete' | 'error';
    localFilePath?: string;
    error?: string;
}

const DEFAULT_FORMAT = 'best_audio';

export function usePlaylistDownload() {
    const userId = useUserStore((s) => s.userId);

    const [state, setState] = useState<DownloadState>('idle');
    const [backends, setBackends] = useState<BackendStatusResult[]>([]);
    const [selectedBackend, setSelectedBackend] = useState<string>('ytdlp');
    const [url, setUrl] = useState('');
    const [resolvedTracks, setResolvedTracks] = useState<ResolvedTrack[]>([]);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [preferredFormat, setPreferredFormat] = useState(DEFAULT_FORMAT);
    const [progress, setProgress] = useState<Map<string, TrackProgress>>(new Map());
    const [completedCount, setCompletedCount] = useState(0);
    const [error, setError] = useState<string | null>(null);

    // Keep unsubscribe refs so we can clean up event listeners
    const unsubscribeRefs = useRef<Array<() => void>>([]);

    const cleanupListeners = useCallback(() => {
        unsubscribeRefs.current.forEach((unsub) => unsub());
        unsubscribeRefs.current = [];
    }, []);

    // Check installed backends on mount
    useEffect(() => {
        setState('checking');
        window.electron?.download.checkBackends().then((results) => {
            setBackends(results);
            // Auto-select first installed backend
            const first = results.find((b) => b.installed);
            if (first) setSelectedBackend(first.id);
            setState('idle');
        }).catch(() => setState('idle'));
    }, []);

    // Cleanup listeners on unmount
    useEffect(() => () => cleanupListeners(), [cleanupListeners]);

    const resolveUrl = useCallback(async () => {
        if (!url.trim()) return;
        setState('resolving');
        setError(null);
        try {
            const tracks = await window.electron?.download.resolve({
                backend: selectedBackend,
                input: { type: 'url', url: url.trim() },
            });
            if (!tracks || tracks.length === 0) {
                setError('No tracks found at that URL.');
                setState('error');
                return;
            }
            setResolvedTracks(tracks);
            setSelectedIds(new Set(tracks.map((t) => t.sourceId)));
            setState('selecting');
        } catch (err) {
            setError(`Could not resolve URL: ${err}`);
            setState('error');
        }
    }, [url, selectedBackend]);

    const toggleTrack = useCallback((sourceId: string) => {
        setSelectedIds((prev) => {
            const next = new Set(prev);
            next.has(sourceId) ? next.delete(sourceId) : next.add(sourceId);
            return next;
        });
    }, []);

    const selectAll = useCallback(
        () => setSelectedIds(new Set(resolvedTracks.map((t) => t.sourceId))),
        [resolvedTracks],
    );

    const selectNone = useCallback(() => setSelectedIds(new Set()), []);

    const startDownload = useCallback(async () => {
        const toDownload = resolvedTracks.filter((t) => selectedIds.has(t.sourceId));
        if (toDownload.length === 0) return;

        setState('downloading');
        setError(null);
        setCompletedCount(0);

        // Initialise progress map
        const initialProgress = new Map<string, TrackProgress>(
            toDownload.map((t) => [
                t.sourceUrl,
                { sourceUrl: t.sourceUrl, percent: 0, status: 'pending' },
            ]),
        );
        setProgress(initialProgress);

        // Wire up event listeners
        cleanupListeners();

        const completedPaths = new Map<string, string>(); // sourceUrl → localFilePath

        const unsubProgress = window.electron?.download.onProgress((event: DownloadEvent) => {
            setProgress((prev) => {
                const next = new Map(prev);
                const entry = next.get(event.sourceUrl);
                if (entry) {
                    next.set(event.sourceUrl, {
                        ...entry,
                        percent: event.percent ?? entry.percent,
                        speed: event.speed,
                        eta: event.eta,
                        status: 'downloading',
                    });
                }
                return next;
            });
        });

        const unsubComplete = window.electron?.download.onTrackComplete((event: DownloadEvent) => {
            if (event.localFilePath) {
                completedPaths.set(event.sourceUrl, event.localFilePath);
            }
            setProgress((prev) => {
                const next = new Map(prev);
                const entry = next.get(event.sourceUrl);
                if (entry) {
                    next.set(event.sourceUrl, {
                        ...entry,
                        percent: 100,
                        status: 'complete',
                        localFilePath: event.localFilePath,
                    });
                }
                return next;
            });
            setCompletedCount((n) => {
                const newCount = n + 1;
                if (newCount >= toDownload.length) {
                    // All tracks done — import into RxDB, enrich with purchase links, then transition
                    void importCompleted(toDownload, completedPaths, userId).then(() =>
                        setState('done'),
                    );
                }
                return newCount;
            });
        });

        const unsubError = window.electron?.download.onError((event: DownloadEvent) => {
            setProgress((prev) => {
                const next = new Map(prev);
                const entry = next.get(event.sourceUrl);
                if (entry) {
                    next.set(event.sourceUrl, { ...entry, status: 'error', error: event.error });
                }
                return next;
            });
        });

        if (unsubProgress) unsubscribeRefs.current.push(unsubProgress);
        if (unsubComplete) unsubscribeRefs.current.push(unsubComplete);
        if (unsubError) unsubscribeRefs.current.push(unsubError);

        try {
            await window.electron?.download.start({
                backend: selectedBackend,
                tracks: toDownload.map((t) => ({
                    sourceUrl: t.sourceUrl,
                    sourceProvider: t.sourceProvider,
                    preferredFormat,
                })),
            });
        } catch (err) {
            setError(`Download failed to start: ${err}`);
            setState('error');
            cleanupListeners();
        }
    }, [resolvedTracks, selectedIds, selectedBackend, preferredFormat, cleanupListeners, userId]);

    const cancel = useCallback(async () => {
        await window.electron?.download.cancel();
        cleanupListeners();
        setState('idle');
    }, [cleanupListeners]);

    const reset = useCallback(() => {
        cleanupListeners();
        setUrl('');
        setResolvedTracks([]);
        setSelectedIds(new Set());
        setProgress(new Map());
        setCompletedCount(0);
        setError(null);
        setState('idle');
    }, [cleanupListeners]);

    return {
        state,
        backends,
        selectedBackend,
        setSelectedBackend,
        url,
        setUrl,
        resolvedTracks,
        selectedIds,
        preferredFormat,
        setPreferredFormat,
        progress,
        completedCount,
        error,
        resolveUrl,
        toggleTrack,
        selectAll,
        selectNone,
        startDownload,
        cancel,
        reset,
    };
}

/** Import completed downloads into RxDB, then fire-and-forget purchase link enrichment. */
async function importCompleted(
    tracks: ResolvedTrack[],
    completedPaths: Map<string, string>,
    userId: string,
): Promise<void> {
    const completed = tracks.filter((t) => completedPaths.has(t.sourceUrl));
    if (completed.length === 0) return;

    const toImport = completed.map((t) => ({
        title: t.title,
        artists: t.artists,
        album: t.album,
        durationMs: t.durationMs,
        source: t.sourceProvider,
        sourceUrl: t.sourceUrl,
        localFilePath: completedPaths.get(t.sourceUrl),
        albumArtUrl: t.thumbnailUrl,
        addedBy: userId,
        addedAt: new Date().toISOString(),
    }));

    const ids = await bulkImportTracks(toImport);

    // Background enrichment — fire-and-forget, does not block state transition
    void enrichWithPurchaseLinks(completed, ids);
}

/** Resolve purchase links for downloaded tracks and persist to RxDB. */
async function enrichWithPurchaseLinks(tracks: ResolvedTrack[], ids: string[]): Promise<void> {
    for (let i = 0; i < tracks.length; i++) {
        const track = tracks[i];
        const id = ids[i];
        if (!track || !id) continue;
        try {
            const links = await window.electron?.purchase.resolve({
                title: track.title,
                artists: track.artists,
                album: track.album || undefined,
            });
            if (links && links.length > 0) {
                await updateTrack(id, { purchaseLinks: links });
            }
        } catch {
            // Non-fatal — enrichment is best-effort
        }
    }
}
