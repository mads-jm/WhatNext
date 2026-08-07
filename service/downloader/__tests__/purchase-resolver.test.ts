import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PurchaseResolver } from '../purchase-resolver';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeMbSearchResponse(mbid: string) {
    return { recordings: [{ id: mbid }] };
}

function makeMbRelationsResponse(
    relations: Array<{ type: string; url: { resource: string } }>,
) {
    return { relations };
}

const BANDCAMP_HTML_WITH_MATCH = `
<a href="https://burial.bandcamp.com/track/archangel" class="item-link">Archangel</a>
`;

const BANDCAMP_HTML_NO_MATCH = `
<a href="https://unknownartist.bandcamp.com/track/sometrack">Sometrack</a>
`;

// ── Setup ─────────────────────────────────────────────────────────────────────

let tmpDir: string;
let resolver: PurchaseResolver;

beforeEach(async () => {
    tmpDir = await fs.promises.mkdtemp(
        path.join(os.tmpdir(), 'whatnext-resolver-test-'),
    );
    resolver = new PurchaseResolver(tmpDir);
    await resolver.init();
    vi.resetAllMocks();
});

afterEach(async () => {
    vi.restoreAllMocks();
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('PurchaseResolver', () => {
    describe('cache behaviour', () => {
        it('returns cached result without a network call on second resolve', async () => {
            const fetchMock = vi
                .spyOn(globalThis, 'fetch')
                .mockResolvedValueOnce({
                    ok: true,
                    json: async () => makeMbSearchResponse('mbid-001'),
                } as Response)
                .mockResolvedValueOnce({
                    ok: true,
                    json: async () =>
                        makeMbRelationsResponse([
                            {
                                type: 'purchase for download',
                                url: {
                                    resource:
                                        'https://burial.bandcamp.com/track/archangel',
                                },
                            },
                        ]),
                } as Response);

            const req = { title: 'Archangel', artists: ['Burial'] };
            await resolver.resolve(req);

            // Second call — should be a cache hit, no more fetch calls
            fetchMock.mockClear();
            const cached = await resolver.resolve(req);

            expect(fetchMock).not.toHaveBeenCalled();
            expect(cached[0]?.provider).toBe('bandcamp');
        });

        it('persists cache to disk so a fresh instance can read it', async () => {
            vi.spyOn(globalThis, 'fetch')
                .mockResolvedValueOnce({
                    ok: true,
                    json: async () => makeMbSearchResponse('mbid-002'),
                } as Response)
                .mockResolvedValueOnce({
                    ok: true,
                    json: async () =>
                        makeMbRelationsResponse([
                            {
                                type: 'purchase for download',
                                url: {
                                    resource:
                                        'https://burial.bandcamp.com/track/archangel',
                                },
                            },
                        ]),
                } as Response);

            await resolver.resolve({ title: 'Archangel', artists: ['Burial'] });

            // Flush the serialised write chain by waiting a tick
            await new Promise((r) => setTimeout(r, 20));

            const resolver2 = new PurchaseResolver(tmpDir);
            await resolver2.init();
            const spy = vi.spyOn(globalThis, 'fetch');
            const result = await resolver2.resolve({
                title: 'Archangel',
                artists: ['Burial'],
            });

            expect(spy).not.toHaveBeenCalled();
            expect(result).toHaveLength(1);
        });
    });

    describe('MusicBrainz path', () => {
        it('returns purchase link from MB URL relations', async () => {
            vi.spyOn(globalThis, 'fetch')
                .mockResolvedValueOnce({
                    ok: true,
                    json: async () => makeMbSearchResponse('mbid-abc'),
                } as Response)
                .mockResolvedValueOnce({
                    ok: true,
                    json: async () =>
                        makeMbRelationsResponse([
                            {
                                type: 'purchase for download',
                                url: {
                                    resource:
                                        'https://artist.bandcamp.com/track/song',
                                },
                            },
                        ]),
                } as Response);

            const result = await resolver.resolve({
                title: 'Song',
                artists: ['Artist'],
            });
            expect(result).toHaveLength(1);
            expect(result[0]?.provider).toBe('bandcamp');
            expect(result[0]?.url).toBe(
                'https://artist.bandcamp.com/track/song',
            );
        });

        it('skips non-purchase relation types', async () => {
            vi.spyOn(globalThis, 'fetch')
                .mockResolvedValueOnce({
                    ok: true,
                    json: async () => makeMbSearchResponse('mbid-xyz'),
                } as Response)
                .mockResolvedValueOnce({
                    ok: true,
                    json: async () =>
                        makeMbRelationsResponse([
                            {
                                type: 'streaming',
                                url: {
                                    resource:
                                        'https://open.spotify.com/track/abc',
                                },
                            },
                        ]),
                } as Response);

            const result = await resolver.resolve({
                title: 'Song',
                artists: ['Artist'],
            });
            expect(result).toHaveLength(0);
        });

        it('handles relations field being a non-array gracefully (Array.isArray guard)', async () => {
            vi.spyOn(globalThis, 'fetch')
                .mockResolvedValueOnce({
                    ok: true,
                    json: async () => makeMbSearchResponse('mbid-guard'),
                } as Response)
                .mockResolvedValueOnce({
                    ok: true,
                    // relations is null — should not throw
                    json: async () => ({ relations: null }),
                } as Response);

            const result = await resolver.resolve({
                title: 'Song',
                artists: ['Artist'],
            });
            expect(result).toHaveLength(0);
        });

        it('returns empty array when MB search returns no recordings', async () => {
            vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
                ok: true,
                json: async () => ({ recordings: [] }),
            } as Response);

            const result = await resolver.resolve({
                title: 'Unknown Song',
                artists: ['Unknown'],
            });
            expect(result).toHaveLength(0);
        });

        it('falls through to Bandcamp when MB search fails', async () => {
            vi.spyOn(globalThis, 'fetch')
                // MB search fails
                .mockResolvedValueOnce({
                    ok: false,
                    json: async () => ({}),
                } as Response)
                // Bandcamp succeeds
                .mockResolvedValueOnce({
                    ok: true,
                    text: async () => BANDCAMP_HTML_WITH_MATCH,
                } as Response);

            const result = await resolver.resolve({
                title: 'Archangel',
                artists: ['Burial'],
            });
            expect(result[0]?.provider).toBe('bandcamp');
        });
    });

    describe('Bandcamp fallback', () => {
        it('extracts track URL from Bandcamp search HTML', async () => {
            vi.spyOn(globalThis, 'fetch')
                // MB search finds nothing
                .mockResolvedValueOnce({
                    ok: true,
                    json: async () => ({ recordings: [] }),
                } as Response)
                // Bandcamp HTML
                .mockResolvedValueOnce({
                    ok: true,
                    text: async () => BANDCAMP_HTML_WITH_MATCH,
                } as Response);

            const result = await resolver.resolve({
                title: 'Archangel',
                artists: ['Burial'],
            });
            expect(result).toHaveLength(1);
            expect(result[0]?.url).toContain('burial.bandcamp.com');
        });

        it('returns empty when no matching artist slug in Bandcamp results', async () => {
            vi.spyOn(globalThis, 'fetch')
                .mockResolvedValueOnce({
                    ok: true,
                    json: async () => ({ recordings: [] }),
                } as Response)
                .mockResolvedValueOnce({
                    ok: true,
                    text: async () => BANDCAMP_HTML_NO_MATCH,
                } as Response);

            // Artist "Burial" slug = "burial" — does NOT match "unknownartist"
            const result = await resolver.resolve({
                title: 'Archangel',
                artists: ['Burial'],
            });
            expect(result).toHaveLength(0);
        });

        it('skips the artist slug check for artists with very short slugs (≤3 chars)', async () => {
            vi.spyOn(globalThis, 'fetch')
                .mockResolvedValueOnce({
                    ok: true,
                    json: async () => ({ recordings: [] }),
                } as Response)
                .mockResolvedValueOnce({
                    ok: true,
                    text: async () => `
                        <a href="https://afx.bandcamp.com/track/song">Song</a>
                    `,
                } as Response);

            // "AFX" → slug "afx" (3 chars) — slug check is skipped
            const result = await resolver.resolve({
                title: 'Song',
                artists: ['AFX'],
            });
            expect(result[0]?.url).toContain('afx.bandcamp.com');
        });
    });

    describe('resolveBatch', () => {
        it('resolves multiple requests sequentially and returns parallel results', async () => {
            vi.spyOn(globalThis, 'fetch').mockResolvedValue({
                ok: true,
                json: async () => ({ recordings: [] }),
                text: async () => '',
            } as unknown as Response);

            const results = await resolver.resolveBatch([
                { title: 'Track A', artists: ['Artist A'] },
                { title: 'Track B', artists: ['Artist B'] },
            ]);
            expect(results).toHaveLength(2);
            expect(Array.isArray(results[0])).toBe(true);
            expect(Array.isArray(results[1])).toBe(true);
        });
    });

    describe('cache key', () => {
        it('treats different capitalisation as the same key', async () => {
            vi.spyOn(globalThis, 'fetch').mockResolvedValue({
                ok: true,
                json: async () => ({ recordings: [] }),
                text: async () => '',
            } as unknown as Response);

            const r1 = await resolver.resolve({
                title: 'Song',
                artists: ['Artist'],
            });
            const fetchCallCount = (
                globalThis.fetch as ReturnType<typeof vi.fn>
            ).mock.calls.length;

            const r2 = await resolver.resolve({
                title: 'SONG',
                artists: ['ARTIST'],
            });
            // Should hit cache — no additional fetch calls
            expect(
                (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls
                    .length,
            ).toBe(fetchCallCount);
            expect(r1).toEqual(r2);
        });
    });
});
