/**
 * path-safety — containment and sanitisation helpers shared by the file-transfer
 * receive path (peer-supplied filenames) and the renderer-facing IPC guards.
 *
 * These behaviours were previously private to file-transfer-ipc.ts and untested;
 * hoisting them into a shared module makes them worth locking down directly, since
 * two callers now depend on the exact semantics (case folding, `+ sep` prefix guard).
 */

import { describe, it, expect } from 'vitest';
import * as path from 'path';
import {
    sanitizeFilename,
    isValidSha256,
    isPathContained,
    assertPathContained,
} from '../path-safety';

const HASH = 'a'.repeat(64);

describe('isPathContained', () => {
    const root = path.resolve('/srv/whatnext/artwork');

    it('accepts the root itself and files beneath it', () => {
        expect(isPathContained(root, root)).toBe(true);
        expect(isPathContained(path.join(root, 'cover.jpg'), root)).toBe(true);
        expect(isPathContained(path.join(root, 'sub', 'cover.jpg'), root)).toBe(true);
    });

    it('rejects traversal that escapes the root', () => {
        expect(isPathContained(path.join(root, '..', 'secrets.jpg'), root)).toBe(false);
        expect(isPathContained(path.join(root, 'a', '..', '..', 'x.jpg'), root)).toBe(false);
    });

    it('rejects a sibling directory that shares the root prefix', () => {
        expect(isPathContained(`${root}Extra${path.sep}cover.jpg`, root)).toBe(false);
        expect(isPathContained(`${root}-backup`, root)).toBe(false);
    });

    it('rejects an unrelated absolute path', () => {
        expect(isPathContained(path.resolve('/etc/passwd'), root)).toBe(false);
    });
});

describe('assertPathContained', () => {
    const root = path.resolve('/srv/whatnext/audio');

    it('is silent for a contained path', () => {
        expect(() => assertPathContained(path.join(root, 'song.mp3'), root)).not.toThrow();
    });

    it('throws for an escaping path', () => {
        expect(() =>
            assertPathContained(path.join(root, '..', '..', 'authorized_keys'), root),
        ).toThrow(/Path traversal rejected/);
    });
});

describe('isValidSha256', () => {
    it('accepts a 64-char hex digest', () => {
        expect(isValidSha256(HASH)).toBe(true);
    });

    it('rejects wrong lengths and traversal payloads', () => {
        expect(isValidSha256('abc')).toBe(false);
        expect(isValidSha256('../../.config/attack')).toBe(false);
        expect(isValidSha256(`${HASH}/../x`)).toBe(false);
    });
});

describe('sanitizeFilename', () => {
    it('strips directory components and traversal sequences', () => {
        expect(sanitizeFilename('../../.ssh/authorized_keys', HASH)).toBe(
            'authorized_keys.bin',
        );
        expect(sanitizeFilename('sub/dir/song.mp3', HASH)).toBe('song.mp3');
    });

    it('keeps an ordinary filename intact', () => {
        expect(sanitizeFilename('Artist - Album.jpg', HASH)).toBe('Artist - Album.jpg');
    });

    it('falls back to the hash prefix when nothing usable remains', () => {
        expect(sanitizeFilename('...', HASH)).toBe(`${HASH.slice(0, 8)}.bin`);
    });
});
