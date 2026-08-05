/**
 * useLibraryDownload — state machine for downloading audio for existing library tracks.
 *
 * State machine:
 *   loading → idle → selecting → downloading → done
 *                                              ↘ error
 *
 * Flow:
 *   1. On mount, query RxDB for tracks with spotifyId but no localFilePath
 *   2. User selects tracks + preferred format
 *   3. Start spotDL download via download:start IPC (backend = 'spotdl', input type = 'spotify-ids')
 *   4. Listen to progress/complete/error events
 *   5. On completion, update existing track documents with localFilePath
 *      (source stays 'spotify' — we're enriching, not replacing)
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { getDatabase } from '../db/database';
import { updateTrack } from '../db/services/track-service';
import type { TrackDocument } from '../db/schemas';
import type { DownloadEvent } from '../../../../service/downloader/types';
import type { TrackProgress } from './usePlaylistDownload';

export type LibraryDownloadState =
    | 'loading'
    | 'idle'
    | 'downloading'
    | 'done'
    | 'error';

const DEFAULT_FORMAT = 'mp3';

export function useLibraryDownload() {
    const [state, setState] = useState<LibraryDownloadState>('loading');
    const [candidates, setCandidates] = useState<TrackDocument[]>([]);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [preferredFormat, setPreferredFormat] = useState(DEFAULT_FORMAT);
    const [progress, setProgress] = useState<Map<string, TrackProgress>>(new Map());
    const [completedCount, setCompletedCount] = useState(0);
    const [error, setError] = useState<string | null>(null);

    const unsubscribeRefs = useRef<Array<() => void>>([]);
    const isMountedRef = useRef(true);

    const cleanupListeners = useCallback(() => {
        unsubscribeRefs.current.forEach((unsub) => unsub());
        unsubscribeRefs.current = [];
    }, []);

    // Load eligible tracks on mount
    useEffect(() => {
        let cancelled = false;
        getDatabase()
            .then((db) =>
                db.tracks
                    .find({
                        selector: {
                            spotifyId: { $exists: true, $ne: null },
                        },
                    })
                    .exec(),
            )
            .then((docs) => {
                if (cancelled) return;
                // Post-filter: no localFilePath set
                const eligible = docs.filter(
                    (d) => d.spotifyId && (!d.localFilePath || d.localFilePath === ''),
                );
                setCandidates(eligible);
                setSelectedIds(new Set(eligible.map((d) => d.id)));
                setState('idle');
            })
            .catch(() => {
                if (!cancelled) setState('idle');
            });
        return () => {
            cancelled = true;
        };
    }, []);

    useEffect(() => {
        isMountedRef.current = true;
        return () => {
            isMountedRef.current = false;
            cleanupListeners();
        };
    }, [cleanupListeners]);

    const toggleTrack = useCallback((id: string) => {
        setSelectedIds((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    }, []);

    const selectAll = useCallback(
        () => setSelectedIds(new Set(candidates.map((d) => d.id))),
        [candidates],
    );

    const selectNone = useCallback(() => setSelectedIds(new Set()), []);

    const startDownload = useCallback(async () => {
        const toDownload = candidates.filter((d) => selectedIds.has(d.id));
        if (toDownload.length === 0) return;

        setState('downloading');
        setError(null);
        setCompletedCount(0);

        // Build a stable sourceUrl for each track so we can correlate events.
        // spotDL receives the spotify track URL; events come back keyed by that URL.
        // candidates are pre-filtered to have a truthy spotifyId; assert here for type safety.
        const spotifyUrls = toDownload.map(
            (d) => `https://open.spotify.com/track/${d.spotifyId!}`,
        );
        const urlToDocId = new Map<string, string>(
            toDownload.map((d, i) => [spotifyUrls[i], d.id]),
        );

        const initialProgress = new Map<string, TrackProgress>(
            toDownload.map((d, i) => [
                spotifyUrls[i],
                { sourceUrl: spotifyUrls[i], percent: 0, status: 'pending' },
            ]),
        );
        setProgress(initialProgress);

        cleanupListeners();

        const completedPaths = new Map<string, string>(); // sourceUrl → localFilePath
        let localCompleted = 0; // Local counter — avoids async calls inside React state updaters

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
            // Without a path there is nothing to patch onto the track document,
            // so `patchTrackDocs` skips it — say so instead of claiming success (#57).
            const willPatch = Boolean(event.localFilePath);
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
                        status: willPatch ? 'complete' : 'unimported',
                        localFilePath: event.localFilePath,
                    });
                }
                return next;
            });
            localCompleted += 1;
            setCompletedCount(localCompleted);
            if (localCompleted >= toDownload.length) {
                void patchTrackDocs(urlToDocId, completedPaths, preferredFormat).then(() => {
                    if (isMountedRef.current) setState('done');
                    void enrichLibraryTracksWithPurchaseLinks(
                        toDownload.map((d) => ({
                            id: d.id,
                            title: d.title,
                            artists: d.artists ?? [],
                            album: d.album ?? '',
                        })),
                    );
                });
            }
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
                backend: 'spotdl',
                tracks: toDownload.map((d, i) => ({
                    sourceUrl: spotifyUrls[i],
                    sourceProvider: 'spotify' as const,
                    preferredFormat,
                })),
            });
        } catch (err) {
            setError(`Download failed to start: ${err}`);
            setState('error');
            cleanupListeners();
        }
    }, [candidates, selectedIds, preferredFormat, cleanupListeners]);

    const cancel = useCallback(async () => {
        await window.electron?.download.cancel();
        cleanupListeners();
        setState('idle');
    }, [cleanupListeners]);

    const reset = useCallback(() => {
        cleanupListeners();
        setSelectedIds(new Set(candidates.map((d) => d.id)));
        setProgress(new Map());
        setCompletedCount(0);
        setError(null);
        setState('idle');
    }, [cleanupListeners, candidates]);

    return {
        state,
        candidates,
        selectedIds,
        preferredFormat,
        setPreferredFormat,
        progress,
        completedCount,
        error,
        toggleTrack,
        selectAll,
        selectNone,
        startDownload,
        cancel,
        reset,
    };
}

/** Patch existing track documents with downloaded file paths, then enrich with purchase links. */
async function patchTrackDocs(
    urlToDocId: Map<string, string>,
    completedPaths: Map<string, string>,
    format: string,
): Promise<void> {
    for (const [url, docId] of urlToDocId) {
        const localFilePath = completedPaths.get(url);
        if (localFilePath) {
            await updateTrack(docId, {
                localFilePath,
                audioFormat: format === 'best_audio' ? 'mp3' : format,
            });
        }
    }
}

/** Resolve purchase links for library tracks and persist to RxDB. Fire-and-forget. */
async function enrichLibraryTracksWithPurchaseLinks(
    tracks: Array<{ id: string; title: string; artists: string[]; album: string }>,
): Promise<void> {
    for (const track of tracks) {
        try {
            const links = await window.electron?.purchase.resolve({
                title: track.title,
                artists: track.artists,
                album: track.album || undefined,
            });
            if (links && links.length > 0) {
                await updateTrack(track.id, { purchaseLinks: links });
            }
        } catch {
            // Non-fatal
        }
    }
}
