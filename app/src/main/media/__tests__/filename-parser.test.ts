import { describe, it, expect } from 'vitest';
import { parseFilename } from '../filename-parser';

describe('parseFilename', () => {
    describe('standard "Artist - Title" format', () => {
        it('splits on " - " separator', () => {
            const r = parseFilename('Aphex Twin - Windowlicker');
            expect(r.title).toBe('Windowlicker');
            expect(r.artists).toEqual(['Aphex Twin']);
            expect(r.year).toBeUndefined();
        });

        it('strips extension before parsing', () => {
            const r = parseFilename('Boards of Canada - Roygbiv.flac');
            expect(r.title).toBe('Roygbiv');
            expect(r.artists).toEqual(['Boards of Canada']);
        });

        it('handles mp3 extension', () => {
            const r = parseFilename('Burial - Archangel.mp3');
            expect(r.title).toBe('Archangel');
            expect(r.artists).toEqual(['Burial']);
        });
    });

    describe('year extraction', () => {
        it('extracts trailing (YYYY) year', () => {
            const r = parseFilename('Portishead - Sour Times (1994)');
            expect(r.year).toBe(1994);
            expect(r.title).toBe('Sour Times');
            expect(r.artists).toEqual(['Portishead']);
        });

        it('extracts year when combined with extension', () => {
            const r = parseFilename('Massive Attack - Teardrop (1998).mp3');
            expect(r.year).toBe(1998);
            expect(r.title).toBe('Teardrop');
        });

        it('ignores out-of-range year values', () => {
            const r = parseFilename('Artist - Title (1800)');
            expect(r.year).toBeUndefined();
            expect(r.title).toBe('Title (1800)');
        });

        it('ignores future years beyond 2100', () => {
            const r = parseFilename('Artist - Title (2200)');
            expect(r.year).toBeUndefined();
        });
    });

    describe('multiple artists', () => {
        it('splits comma-separated artists', () => {
            const r = parseFilename('J Dilla, Madlib - The Shining');
            expect(r.artists).toEqual(['J Dilla', 'Madlib']);
            expect(r.title).toBe('The Shining');
        });

        it('single artist with no comma', () => {
            const r = parseFilename('Four Tet - My Angel Rocks Back and Forth');
            expect(r.artists).toEqual(['Four Tet']);
        });
    });

    describe('no separator fallback', () => {
        it('uses full name as title when no " - " found', () => {
            const r = parseFilename('Interlude');
            expect(r.title).toBe('Interlude');
            expect(r.artists).toEqual([]);
        });

        it('falls back to full name for single-word filename', () => {
            const r = parseFilename('Overture.wav');
            expect(r.title).toBe('Overture');
            expect(r.artists).toEqual([]);
        });
    });

    describe('edge cases', () => {
        it('handles filename without extension and no separator', () => {
            const r = parseFilename('untitled');
            expect(r.title).toBe('untitled');
            expect(r.artists).toEqual([]);
        });

        it('handles title that contains " - " substring', () => {
            // Only first " - " is used as separator
            const r = parseFilename('Danger Mouse - 99 Problems - Jay-Z Remix');
            expect(r.artists).toEqual(['Danger Mouse']);
            expect(r.title).toBe('99 Problems - Jay-Z Remix');
        });

        it('handles leading-space filename with dash but no " - " separator', () => {
            // ' - Title Only' trims to '- Title Only', which contains no ' - '
            // so the whole string becomes the title with no artists
            const r = parseFilename(' - Title Only');
            expect(r.artists).toEqual([]);
            expect(r.title).toBe('- Title Only');
        });
    });
});
