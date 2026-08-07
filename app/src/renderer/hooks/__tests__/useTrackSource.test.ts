// @vitest-environment jsdom
/**
 * useTrackSource — Spotify arm liveness.
 *
 * The environment docblock above is deliberate: the rest of the suite runs in
 * the default `node` environment (vitest.config.ts), and only renderer hook
 * tests need a DOM. Opting in per-file keeps the jsdom cost off every other
 * suite and avoids `environmentMatchGlobs`, which Vitest 3 deprecates.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';

// The hook's DB collaborators are irrelevant to the liveness contract under
// test (no-change polls never reach them) — stub the modules so the test does
// not boot RxDB.
vi.mock('../../db/database', () => ({ getDatabase: vi.fn() }));
vi.mock('../../db/services/playlist-service', () => ({
    bulkAddTracksToPlaylist: vi.fn(),
    removeTrackFromPlaylist: vi.fn(),
}));
vi.mock('../../db/services/track-service', () => ({
    bulkImportTracks: vi.fn(),
}));
vi.mock('../../db/services/user-service', () => ({
    createSessionParticipant: vi.fn(),
}));
vi.mock('../../db/services/track-sink', () => ({ addIncomingTrack: vi.fn() }));

import { getDatabase } from '../../db/database';
import { useTrackSource } from '../useTrackSource';
import type { TrackSourceConfig } from '../../../shared/session-interfaces';

interface SnapshotResult {
    success: boolean;
    snapshotId?: string;
    total?: number;
    error?: string;
}

const CONFIG: TrackSourceConfig = {
    type: 'spotify-collab',
    spotifyPlaylistId: 'spotify-playlist-1',
};

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((r) => {
        resolve = r;
    });
    return { promise, resolve };
}

const getPlaylistSnapshot =
    vi.fn<(playlistId: string) => Promise<SnapshotResult>>();
const getPlaylistTracksFrom = vi.fn(async () => ({
    success: true,
    tracks: [],
}));
const getPlaylistTracksFull = vi.fn(async () => ({
    success: true,
    tracks: [],
}));

beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getDatabase).mockResolvedValue({
        playlists: {
            findOne: () => ({ exec: async () => ({ trackIds: [] }) }),
        },
        // Justification: this stands in for a whole `RxDatabase<WhatNextCollections>`
        // while implementing the one query under test. Typing it honestly means
        // constructing five real RxCollections (or a deep Partial that RxDB's
        // types reject), which would be more mock than test.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    Object.assign(window, {
        electron: {
            spotify: {
                getPlaylistSnapshot,
                getPlaylistTracksFrom,
                getPlaylistTracksFull,
            },
        },
    });
});

afterEach(() => {
    cleanup();
    vi.useRealTimers();
});

function mountHook(enabled = true) {
    return renderHook(
        ({ enabled: on }: { enabled: boolean }) =>
            useTrackSource({ config: CONFIG, playlistId: 'pl-1', enabled: on }),
        { initialProps: { enabled } },
    );
}

describe('useTrackSource sync loop', () => {
    it('resumes polling after a poll is interrupted by an effect teardown', async () => {
        // The in-flight poll is still pending when the effect tears down.
        const inFlight = deferred<SnapshotResult>();
        getPlaylistSnapshot.mockReturnValueOnce(inFlight.promise);

        const { rerender, result } = mountHook(true);
        expect(getPlaylistSnapshot).toHaveBeenCalledTimes(1);

        // Teardown mid-poll. `syncingRef` survives this — it lives on the
        // component, not the effect — which is exactly how the loop used to
        // wedge: `finally` skipped the reset because `cancelled` was true.
        rerender({ enabled: false });

        await act(async () => {
            inFlight.resolve({ success: true, snapshotId: 'snap-1', total: 0 });
            await inFlight.promise;
        });

        // Re-arm the loop. Pre-fix this poll returned at the in-flight guard
        // and the Spotify arm never synced again.
        getPlaylistSnapshot.mockResolvedValue({
            success: true,
            snapshotId: 'snap-2',
            total: 0,
        });
        await act(async () => {
            rerender({ enabled: true });
        });

        expect(getPlaylistSnapshot).toHaveBeenCalledTimes(2);
        expect(result.current.lastSyncAt).not.toBeNull();
        expect(result.current.syncing).toBe(false);
    });

    it('leaves the loop usable when a poll rejects', async () => {
        getPlaylistSnapshot.mockRejectedValueOnce(new Error('network down'));
        const { result } = mountHook(true);

        await act(async () => {
            await Promise.resolve();
        });
        expect(result.current.error).toBe('network down');

        getPlaylistSnapshot.mockResolvedValue({
            success: true,
            snapshotId: 'snap-1',
            total: 0,
        });
        await act(async () => {
            result.current.syncNow?.();
        });

        expect(getPlaylistSnapshot).toHaveBeenCalledTimes(2);
        expect(result.current.error).toBeNull();
    });
});

describe('useTrackSource poll cadence', () => {
    it('does not poll again inside the 10s floor, and is still polling by 15s', async () => {
        vi.useFakeTimers();
        getPlaylistSnapshot.mockResolvedValue({
            success: true,
            snapshotId: 'snap-1',
            total: 0,
        });

        mountHook(true);
        await act(async () => {
            await vi.advanceTimersByTimeAsync(0);
        });
        expect(getPlaylistSnapshot).toHaveBeenCalledTimes(1);

        // Floor: the old 2s cadence (30 req/min) would have fired ~5 times here.
        await act(async () => {
            await vi.advanceTimersByTimeAsync(9_999);
        });
        expect(getPlaylistSnapshot).toHaveBeenCalledTimes(1);

        // Ceiling: still a live poll loop, not an effectively-disabled one.
        await act(async () => {
            await vi.advanceTimersByTimeAsync(15_000 - 9_999);
        });
        expect(getPlaylistSnapshot).toHaveBeenCalledTimes(2);
    });

    it('short-circuits on an unchanged snapshot without fetching tracks', async () => {
        getPlaylistSnapshot.mockResolvedValue({
            success: true,
            snapshotId: 'snap-1',
            total: 7,
        });

        const { result } = mountHook(true);
        await act(async () => {
            await Promise.resolve();
        });
        // First poll has no remembered snapshot, so it fetches the tail once.
        expect(getPlaylistTracksFrom).toHaveBeenCalledTimes(1);

        await act(async () => {
            result.current.syncNow?.();
        });

        expect(getPlaylistSnapshot).toHaveBeenCalledTimes(2);
        // Second poll saw the same snapshotId → no tail re-fetch, no full sync.
        expect(getPlaylistTracksFrom).toHaveBeenCalledTimes(1);
        expect(getPlaylistTracksFull).not.toHaveBeenCalled();
    });
});
