/**
 * spotify-mapper.ts — pure Spotify-wire → WhatNext-track mapping.
 *
 * Owns every case for `mapSpotifyTrack` / `mapSpotifyTracks`: field-by-field
 * mapping, the fallbacks, and the guards that drop the degenerate playlist
 * entries Spotify actually sends. Nothing here touches Electron, the network or
 * the IPC surface — the only mock is `uuid`, because the mapper mints an id.
 *
 * The IPC handlers that *call* this mapper are covered in
 * `main/__tests__/ipc.test.ts`.
 */

import { describe, it, expect, vi } from 'vitest';
import type { SpotifyTrackItem } from '../../types';

// uuid is called inside mapSpotifyTrack; we mock it to get deterministic IDs.
vi.mock('uuid', () => ({ v4: () => 'test-uuid' }));

import {
    mapSpotifyTrack,
    mapSpotifyTracks,
    type MappedTrack,
} from '../spotify-mapper';
import { makeTrackItem } from './track-fixtures';

/**
 * The wire shape Spotify actually sends: `track` is `null` for removed or
 * region-unavailable playlist entries, which is exactly why `mapSpotifyTracks`
 * filters on `item.track && item.track.id`. The app-side `SpotifyTrackItem`
 * models only the well-formed case, so those degenerate entries are not
 * expressible in it — a design smell worth fixing at the source one day, but
 * out of scope for a lint burn-down.
 *
 * Rather than casting each malformed fixture, the guard tests describe their
 * input precisely with this type and call the mapper through the local view of
 * its signature below. That keeps the fixtures fully typed and confines the
 * widening to one documented place.
 */
type RawSpotifyTrackItem = Omit<SpotifyTrackItem, 'track'> & {
    track: SpotifyTrackItem['track'] | null;
};

/** `mapSpotifyTracks` drops null/idless tracks, so it is safe on raw wire items. */
const mapRawSpotifyTracks = mapSpotifyTracks as (
    items: RawSpotifyTrackItem[],
) => MappedTrack[];

describe('mapSpotifyTrack', () => {
    it('maps title from track.name', () => {
        const result = mapSpotifyTrack(makeTrackItem());
        expect(result.title).toBe('Test Track');
    });

    it('maps artists array from track.artists', () => {
        const item = makeTrackItem({
            track: {
                ...makeTrackItem().track,
                artists: [
                    { name: 'Artist A', id: 'a' },
                    { name: 'Artist B', id: 'b' },
                ],
            },
        });
        const result = mapSpotifyTrack(item);
        expect(result.artists).toEqual(['Artist A', 'Artist B']);
    });

    it('maps album name from track.album.name', () => {
        const result = mapSpotifyTrack(makeTrackItem());
        expect(result.album).toBe('Test Album');
    });

    it('maps durationMs from track.duration_ms', () => {
        const result = mapSpotifyTrack(makeTrackItem());
        expect(result.durationMs).toBe(200000);
    });

    it('maps spotifyId from track.id', () => {
        const result = mapSpotifyTrack(makeTrackItem());
        expect(result.spotifyId).toBe('spotify-track-id-1');
    });

    it('maps albumArtUrl from the first image in track.album.images', () => {
        const result = mapSpotifyTrack(makeTrackItem());
        expect(result.albumArtUrl).toBe('https://cdn/image.jpg');
    });

    it('sets albumArtUrl to undefined when images array is empty', () => {
        const item = makeTrackItem({
            track: {
                ...makeTrackItem().track,
                album: { name: 'Album No Art', images: [] },
            },
        });
        const result = mapSpotifyTrack(item);
        expect(result.albumArtUrl).toBeUndefined();
    });

    it('maps addedAt from item.added_at', () => {
        const result = mapSpotifyTrack(makeTrackItem());
        expect(result.addedAt).toBe('2024-01-15T12:00:00Z');
    });

    it('falls back addedAt to a current ISO string when added_at is falsy', () => {
        const item = makeTrackItem({ added_at: '' });
        const before = Date.now();
        const result = mapSpotifyTrack(item);
        const after = Date.now();
        const parsed = Date.parse(result.addedAt);
        expect(parsed).toBeGreaterThanOrEqual(before);
        expect(parsed).toBeLessThanOrEqual(after);
    });

    it('uses item.added_by.id as addedBySpotifyId, not a caller-supplied userId', () => {
        const item = makeTrackItem({ added_by: { id: 'real-owner-id' } });
        const result = mapSpotifyTrack(item);
        expect(result.addedBySpotifyId).toBe('real-owner-id');
    });

    it('generates a uuid for the id field', () => {
        const result = mapSpotifyTrack(makeTrackItem());
        expect(result.id).toBe('test-uuid');
    });
});

describe('mapSpotifyTracks', () => {
    it('maps multiple valid tracks and preserves order', () => {
        const items: SpotifyTrackItem[] = [
            makeTrackItem({
                track: {
                    ...makeTrackItem().track,
                    id: 'track-1',
                    name: 'Song One',
                },
            }),
            makeTrackItem({
                track: {
                    ...makeTrackItem().track,
                    id: 'track-2',
                    name: 'Song Two',
                },
            }),
        ];
        const result = mapSpotifyTracks(items);
        expect(result).toHaveLength(2);
        expect(result[0].spotifyId).toBe('track-1');
        expect(result[1].spotifyId).toBe('track-2');
    });

    it('filters out items whose track is null (null-track guard)', () => {
        const items: RawSpotifyTrackItem[] = [
            makeTrackItem(),
            {
                track: null,
                added_at: '2024-01-01T00:00:00Z',
                added_by: { id: 'x' },
            },
        ];
        const result = mapRawSpotifyTracks(items);
        expect(result).toHaveLength(1);
    });

    it('filters out local tracks that have no track.id (local-file guard)', () => {
        const localTrack = makeTrackItem({
            track: { ...makeTrackItem().track, id: '' },
        });
        const validTrack = makeTrackItem();
        const result = mapSpotifyTracks([localTrack, validTrack]);
        expect(result).toHaveLength(1);
        expect(result[0].spotifyId).toBe('spotify-track-id-1');
    });

    it('returns an empty array when all items are filtered out', () => {
        const items: RawSpotifyTrackItem[] = [
            { track: null, added_at: '', added_by: { id: '' } },
            { track: null, added_at: '', added_by: { id: '' } },
        ];
        expect(mapRawSpotifyTracks(items)).toEqual([]);
    });

    it('returns an empty array for an empty input', () => {
        expect(mapSpotifyTracks([])).toEqual([]);
    });
});
