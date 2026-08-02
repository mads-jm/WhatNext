// @vitest-environment jsdom
/**
 * usePlaylistDownload — #57 regression.
 *
 * A `complete` event carrying no `localFilePath` cannot be imported (import
 * keys on the path), and used to be shown as "complete" anyway: the UI claimed
 * an import that never happened. The track must land in the explicit
 * `unimported` state instead.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { DownloadEvent, ResolvedTrack } from '../../../../../service/downloader/types';

vi.mock('../../db/services/track-service', () => ({
    bulkImportTracks: vi.fn(async () => ['track-id-1']),
    updateTrack: vi.fn(async () => undefined),
}));
vi.mock('../../stores/user-store', () => ({
    useUserStore: (selector: (s: { userId: string }) => unknown) => selector({ userId: 'user-1' }),
}));

import { bulkImportTracks } from '../../db/services/track-service';
import { usePlaylistDownload } from '../usePlaylistDownload';

const WITH_PATH = 'https://youtube.com/watch?v=aaa';
const WITHOUT_PATH = 'https://youtube.com/watch?v=bbb';

function track(sourceUrl: string, sourceId: string): ResolvedTrack {
    return {
        sourceId,
        sourceUrl,
        sourceProvider: 'youtube',
        title: `Title ${sourceId}`,
        artists: ['Artist'],
        album: 'Album',
        durationMs: 1000,
        availableFormats: [],
    };
}

/** Listeners registered by the hook, so the test can emit backend events. */
let onComplete: ((e: DownloadEvent) => void) | undefined;

beforeEach(() => {
    vi.clearAllMocks();
    onComplete = undefined;
    Object.assign(window, {
        electron: {
            download: {
                checkBackends: vi.fn(async () => [
                    { id: 'ytdlp', name: 'yt-dlp', installed: true },
                ]),
                resolve: vi.fn(async () => [
                    track(WITH_PATH, 'a'),
                    track(WITHOUT_PATH, 'b'),
                ]),
                start: vi.fn(async () => undefined),
                cancel: vi.fn(async () => undefined),
                onProgress: vi.fn(() => () => undefined),
                onTrackComplete: vi.fn((cb: (e: DownloadEvent) => void) => {
                    onComplete = cb;
                    return () => undefined;
                }),
                onError: vi.fn(() => () => undefined),
            },
            purchase: { resolve: vi.fn(async () => []) },
        },
    });
});

afterEach(() => cleanup());

/** Drive the hook to the point where both tracks are downloading. */
async function startTwoTrackDownload() {
    const view = renderHook(() => usePlaylistDownload());
    await act(async () => {
        await Promise.resolve();
    });
    act(() => view.result.current.setUrl('https://youtube.com/playlist?list=x'));
    await act(async () => {
        await view.result.current.resolveUrl();
    });
    await act(async () => {
        await view.result.current.startDownload();
    });
    return view;
}

describe('usePlaylistDownload completion handling', () => {
    it('marks a completed track with no file path as unimported, not complete', async () => {
        const { result } = await startTwoTrackDownload();

        await act(async () => {
            onComplete?.({ type: 'complete', sourceUrl: WITH_PATH, localFilePath: '/audio/a.mp3' });
        });
        await act(async () => {
            onComplete?.({ type: 'complete', sourceUrl: WITHOUT_PATH });
        });

        expect(result.current.progress.get(WITH_PATH)?.status).toBe('complete');
        expect(result.current.progress.get(WITHOUT_PATH)?.status).toBe('unimported');
        expect(result.current.state).toBe('done');
    });

    it('imports only the track whose file path is known', async () => {
        const { result } = await startTwoTrackDownload();

        await act(async () => {
            onComplete?.({ type: 'complete', sourceUrl: WITH_PATH, localFilePath: '/audio/a.mp3' });
            onComplete?.({ type: 'complete', sourceUrl: WITHOUT_PATH });
        });

        expect(bulkImportTracks).toHaveBeenCalledTimes(1);
        const imported = vi.mocked(bulkImportTracks).mock.calls[0][0];
        expect(imported).toHaveLength(1);
        expect(imported[0]).toMatchObject({
            sourceUrl: WITH_PATH,
            localFilePath: '/audio/a.mp3',
        });
        // The dropped track is still accounted for in the UI state, not silent.
        expect(result.current.progress.get(WITHOUT_PATH)?.status).toBe('unimported');
    });

    it('leaves the path-present flow unchanged', async () => {
        const { result } = await startTwoTrackDownload();

        await act(async () => {
            onComplete?.({ type: 'complete', sourceUrl: WITH_PATH, localFilePath: '/audio/a.mp3' });
            onComplete?.({ type: 'complete', sourceUrl: WITHOUT_PATH, localFilePath: '/audio/b.mp3' });
        });

        expect(result.current.progress.get(WITH_PATH)?.status).toBe('complete');
        expect(result.current.progress.get(WITHOUT_PATH)?.status).toBe('complete');
        expect(vi.mocked(bulkImportTracks).mock.calls[0][0]).toHaveLength(2);
        expect(result.current.state).toBe('done');
    });
});
