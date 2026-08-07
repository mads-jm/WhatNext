import { describe, it, expect } from 'vitest';
import { detectProvider, mapYtdlpEntry, mapYtdlpEntries } from '../mapper';

describe('detectProvider', () => {
    it('returns youtube for youtube extractor', () => {
        expect(detectProvider('youtube')).toBe('youtube');
        expect(detectProvider('YoutubeTab')).toBe('youtube');
    });

    it('returns soundcloud for soundcloud extractor', () => {
        expect(detectProvider('SoundCloud')).toBe('soundcloud');
    });

    it('returns bandcamp for bandcamp extractor', () => {
        expect(detectProvider('Bandcamp')).toBe('bandcamp');
        expect(detectProvider('BandcampAlbum')).toBe('bandcamp');
    });

    it('returns spotify for spotify extractor', () => {
        expect(detectProvider('Spotify')).toBe('spotify');
    });

    it('defaults to youtube for unknown extractors', () => {
        expect(detectProvider('vimeo')).toBe('youtube');
        expect(detectProvider('')).toBe('youtube');
    });
});

describe('mapYtdlpEntry', () => {
    const base: Record<string, unknown> = {
        id: 'abc123',
        webpage_url: 'https://www.youtube.com/watch?v=abc123',
        title: 'Test Track',
        uploader: 'Test Artist',
        album: 'Test Album',
        duration: 200,
        thumbnail: 'https://img.example.com/thumb.jpg',
        extractor: 'youtube',
        formats: [],
    };

    it('maps basic fields correctly', () => {
        const result = mapYtdlpEntry(base);
        expect(result.sourceId).toBe('abc123');
        expect(result.sourceUrl).toBe('https://www.youtube.com/watch?v=abc123');
        expect(result.title).toBe('Test Track');
        expect(result.artists).toEqual(['Test Artist']);
        expect(result.album).toBe('Test Album');
        expect(result.durationMs).toBe(200_000);
        expect(result.thumbnailUrl).toBe('https://img.example.com/thumb.jpg');
        expect(result.sourceProvider).toBe('youtube');
    });

    it('prefers artist field over uploader', () => {
        const raw = {
            ...base,
            artist: 'Real Artist',
            uploader: 'Channel Name',
        };
        const result = mapYtdlpEntry(raw);
        expect(result.artists).toEqual(['Real Artist']);
    });

    it('uses webpage_url over url', () => {
        const raw = {
            ...base,
            webpage_url: 'https://web.url',
            url: 'https://direct.url',
        };
        expect(mapYtdlpEntry(raw).sourceUrl).toBe('https://web.url');
    });

    it('falls back to url when webpage_url is absent', () => {
        // Omit-by-rest: `_` exists only to keep `webpage_url` out of `raw`.
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { webpage_url: _, ...raw } = base;
        const withUrl = { ...raw, url: 'https://direct.url' };
        expect(mapYtdlpEntry(withUrl).sourceUrl).toBe('https://direct.url');
    });

    it('converts duration from seconds to milliseconds', () => {
        const raw = { ...base, duration: 3.5 };
        expect(mapYtdlpEntry(raw).durationMs).toBe(3500);
    });

    it('rounds durationMs', () => {
        const raw = { ...base, duration: 3.756 };
        expect(mapYtdlpEntry(raw).durationMs).toBe(3756);
    });

    it('defaults to 0ms when duration is missing', () => {
        // Omit-by-rest: `_` exists only to keep `duration` out of `raw`.
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { duration: _, ...raw } = base;
        expect(mapYtdlpEntry(raw).durationMs).toBe(0);
    });

    it('omits thumbnailUrl when thumbnail is absent', () => {
        // Omit-by-rest: `_` exists only to keep `thumbnail` out of `raw`.
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { thumbnail: _, ...raw } = base;
        expect(mapYtdlpEntry(raw).thumbnailUrl).toBeUndefined();
    });

    it('defaults title to "Unknown Title" when absent', () => {
        // Omit-by-rest: `_` exists only to keep `title` out of `raw`.
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { title: _, ...raw } = base;
        expect(mapYtdlpEntry(raw).title).toBe('Unknown Title');
    });

    describe('format mapping', () => {
        it('maps audio-only formats (vcodec=none)', () => {
            const raw = {
                ...base,
                formats: [
                    {
                        format_id: 'f1',
                        acodec: 'opus',
                        vcodec: 'none',
                        abr: 128,
                    },
                ],
            };
            const result = mapYtdlpEntry(raw);
            expect(result.availableFormats).toHaveLength(1);
            expect(result.availableFormats[0]).toMatchObject({
                formatId: 'f1',
                codec: 'opus',
                bitrate: 128,
            });
        });

        it('excludes video formats', () => {
            const raw = {
                ...base,
                formats: [
                    {
                        format_id: 'v1',
                        acodec: 'mp4a',
                        vcodec: 'avc1',
                        abr: 128,
                    },
                ],
            };
            expect(mapYtdlpEntry(raw).availableFormats).toHaveLength(0);
        });

        it('excludes formats with acodec=none', () => {
            const raw = {
                ...base,
                formats: [{ format_id: 'v2', acodec: 'none', vcodec: 'none' }],
            };
            expect(mapYtdlpEntry(raw).availableFormats).toHaveLength(0);
        });

        it('includes filesize_approx as filesize fallback', () => {
            const raw = {
                ...base,
                formats: [
                    {
                        format_id: 'f2',
                        acodec: 'opus',
                        vcodec: 'none',
                        filesize_approx: 4_096_000,
                    },
                ],
            };
            const result = mapYtdlpEntry(raw);
            expect(result.availableFormats[0].filesize).toBe(4_096_000);
        });

        it('handles empty formats array', () => {
            expect(
                mapYtdlpEntry({ ...base, formats: [] }).availableFormats,
            ).toEqual([]);
        });

        it('handles non-array formats gracefully', () => {
            expect(
                mapYtdlpEntry({ ...base, formats: null }).availableFormats,
            ).toEqual([]);
        });
    });

    describe('provider detection', () => {
        it('detects soundcloud', () => {
            const raw = { ...base, extractor: 'SoundCloud' };
            expect(mapYtdlpEntry(raw).sourceProvider).toBe('soundcloud');
        });

        it('detects bandcamp', () => {
            const raw = { ...base, extractor: 'BandcampAlbum' };
            expect(mapYtdlpEntry(raw).sourceProvider).toBe('bandcamp');
        });
    });
});

describe('mapYtdlpEntries', () => {
    it('maps an array of entries', () => {
        const raws = [
            {
                id: '1',
                title: 'A',
                webpage_url: 'https://y.com/1',
                extractor: 'youtube',
                duration: 60,
            },
            {
                id: '2',
                title: 'B',
                webpage_url: 'https://y.com/2',
                extractor: 'youtube',
                duration: 90,
            },
        ];
        const results = mapYtdlpEntries(raws);
        expect(results).toHaveLength(2);
        expect(results[0].title).toBe('A');
        expect(results[1].title).toBe('B');
    });

    it('returns empty array for empty input', () => {
        expect(mapYtdlpEntries([])).toEqual([]);
    });
});
