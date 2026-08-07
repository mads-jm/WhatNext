import { describe, it, expect } from 'vitest';
import { fuzzyScore, fuzzyRank } from '../fuzzy';

describe('fuzzyScore', () => {
    it('returns null on a hard miss (not a subsequence)', () => {
        expect(fuzzyScore('xyz', 'Darkside')).toBeNull();
        expect(fuzzyScore('darkz', 'Darkside')).toBeNull();
    });

    it('matches a scattered subsequence (typo-tolerant)', () => {
        expect(fuzzyScore('drksd', 'Darkside')).not.toBeNull();
    });

    it('is case-insensitive', () => {
        expect(fuzzyScore('DARK', 'darkside')).not.toBeNull();
    });

    it('scores a contiguous match higher than a scattered one', () => {
        const contiguous = fuzzyScore('dark', 'Darkside')!;
        const scattered = fuzzyScore('dksd', 'Darkside')!;
        expect(contiguous).toBeGreaterThan(scattered);
    });

    it('rewards a word-boundary / prefix match', () => {
        const prefix = fuzzyScore('boc', 'Boards of Canada')!; // B, o, C at boundaries
        const midword = fuzzyScore('oar', 'Boards of Canada')!;
        expect(prefix).toBeGreaterThan(midword);
    });

    it('treats an empty query as a neutral (0) match', () => {
        expect(fuzzyScore('', 'anything')).toBe(0);
    });

    it('misses against empty text', () => {
        expect(fuzzyScore('a', '')).toBeNull();
    });
});

describe('fuzzyRank', () => {
    interface Track {
        title: string;
        artist: string;
        album: string;
    }
    const lib: Track[] = [
        { title: 'Darkside', artist: 'Bring Me The Horizon', album: 'amo' },
        {
            title: 'Roygbiv',
            artist: 'Boards of Canada',
            album: 'Music Has the Right',
        },
        { title: 'Teardrop', artist: 'Massive Attack', album: 'Mezzanine' },
    ];
    const fields = (t: Track) => [t.title, t.artist, t.album];

    it('returns all items unchanged for an empty query', () => {
        expect(fuzzyRank('', lib, fields)).toEqual(lib);
    });

    it('drops items where no field matches', () => {
        const out = fuzzyRank('darkside', lib, fields);
        expect(out).toHaveLength(1);
        expect(out[0].title).toBe('Darkside');
    });

    it('matches on a non-title field (artist)', () => {
        const out = fuzzyRank('boc', lib, fields);
        expect(out[0].artist).toBe('Boards of Canada');
    });

    it('matches on album', () => {
        const out = fuzzyRank('mezz', lib, fields);
        expect(out[0].album).toBe('Mezzanine');
    });

    it('ranks the best match first', () => {
        const out = fuzzyRank('mass', lib, fields);
        expect(out[0].artist).toBe('Massive Attack');
    });
});
