/**
 * Serve-path authorization — rule-by-rule tests.
 *
 * These exercise the *shipped* guard (no re-implementation of the rules here), so a
 * regression in what we let off the machine fails right here. The wire-level
 * consequence of each verdict — and the fact that a refusal is indistinguishable
 * from a not-found — is covered in `file-transfer-ipc.test.ts`.
 */

import { describe, it, expect } from 'vitest';
import { ServedHashRegistry, evaluateServeRequest } from '../serve-guards';
import type { FileEntry } from '../../../shared/core/file-transfer-types';

const AUDIO = 'a'.repeat(64);
const ARTWORK = 'b'.repeat(64);
const COVER = 'c'.repeat(64);
const PLAYLIST = 'playlist-1';

const entries: FileEntry[] = [
    { trackId: 't1', type: 'audio', sha256: AUDIO, sizeBytes: 10, mimeType: 'audio/mpeg', filename: 'song.mp3' },
    { trackId: 't1', type: 'artwork', sha256: ARTWORK, sizeBytes: 10, mimeType: 'image/jpeg', filename: 'art.jpg' },
    { trackId: PLAYLIST, type: 'cover-art', sha256: COVER, sizeBytes: 10, mimeType: 'image/jpeg', filename: 'cover.jpg' },
];

/** A hash cache that holds every file in `entries` plus one we never published. */
const HELD_BUT_UNPUBLISHED = 'd'.repeat(64);
const held = (sha256: string): string | null =>
    [AUDIO, ARTWORK, COVER, HELD_BUT_UNPUBLISHED].includes(sha256) ? `/files/${sha256}` : null;

describe('ServedHashRegistry', () => {
    it('allowlists every entry type a manifest published — no cover-art gap', () => {
        const registry = new ServedHashRegistry();
        registry.record(PLAYLIST, entries);

        for (const entry of entries) {
            expect(registry.isServable(entry.sha256)).toBe(true);
        }
    });

    it('serves nothing before any manifest has gone out (the restart / fail-closed state)', () => {
        expect(new ServedHashRegistry().isServable(AUDIO)).toBe(false);
    });

    it('withdraws a playlist\'s hashes when sharing is revoked', () => {
        const registry = new ServedHashRegistry();
        registry.record(PLAYLIST, entries);
        registry.revoke(PLAYLIST);

        expect(registry.isServable(AUDIO)).toBe(false);
    });

    it('keeps a shared file servable when only one of the playlists holding it is revoked', () => {
        // The same track can sit in two playlists; turning one off is not consent
        // withdrawn for the other.
        const registry = new ServedHashRegistry();
        registry.record('playlist-a', entries);
        registry.record('playlist-b', [entries[0]]);

        registry.revoke('playlist-a');
        expect(registry.isServable(AUDIO)).toBe(true);
        expect(registry.isServable(ARTWORK)).toBe(false);
    });

    it('replaces rather than accumulates: a file dropped from the playlist stops being servable', () => {
        const registry = new ServedHashRegistry();
        registry.record(PLAYLIST, entries);
        registry.record(PLAYLIST, [entries[0]]);

        expect(registry.isServable(AUDIO)).toBe(true);
        expect(registry.isServable(COVER)).toBe(false);
    });

    it('treats an empty manifest as publishing nothing', () => {
        const registry = new ServedHashRegistry();
        registry.record(PLAYLIST, entries);
        registry.record(PLAYLIST, []);

        expect(registry.isServable(AUDIO)).toBe(false);
    });
});

describe('evaluateServeRequest', () => {
    function shared(): ServedHashRegistry {
        const registry = new ServedHashRegistry();
        registry.record(PLAYLIST, entries);
        return registry;
    }

    it('authorizes a hash we published and still hold', () => {
        expect(evaluateServeRequest(AUDIO, shared(), held)).toEqual({
            ok: true,
            filePath: `/files/${AUDIO}`,
        });
    });

    it('refuses a hash we hold but never published — knowing the hash is not consent', () => {
        const verdict = evaluateServeRequest(HELD_BUT_UNPUBLISHED, shared(), held);
        expect(verdict.ok).toBe(false);
    });

    it('refuses before the path lookup, so an unauthorized hash never reaches the filesystem', () => {
        let lookups = 0;
        const counting = (sha256: string): string | null => {
            lookups++;
            return held(sha256);
        };

        expect(evaluateServeRequest(HELD_BUT_UNPUBLISHED, shared(), counting).ok).toBe(false);
        expect(lookups).toBe(0);
    });

    it('refuses a hash we never held at all (behaviour unchanged for unknown hashes)', () => {
        const registry = shared();
        const unknown = 'e'.repeat(64);
        registry.record('playlist-stale', [{ ...entries[0], sha256: unknown }]);

        expect(evaluateServeRequest(unknown, registry, held).ok).toBe(false);
    });

    it('refuses everything once sharing is revoked', () => {
        const registry = shared();
        registry.revoke(PLAYLIST);

        for (const entry of entries) {
            expect(evaluateServeRequest(entry.sha256, registry, held).ok).toBe(false);
        }
    });
});
