import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { CheckpointStore, resolveCheckpointPath } from '../checkpoint-store';

let tmpDir: string;
let filePath: string;

beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wn-ckpt-'));
    filePath = path.join(tmpDir, 'replication-checkpoints.json');
});

afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('CheckpointStore round-trip', () => {
    it('persists checkpoints and reloads them in a fresh instance (restart sim)', async () => {
        const store = new CheckpointStore(filePath, 0);
        await store.load();
        store.set('peerA:playlists', '2026-06-27T00:00:00.000Z');
        store.set('peerA:tracks', '2026-06-27T00:00:01.000Z');
        await store.flush();

        // Simulate a process restart: brand-new instance reading the same file.
        const reloaded = new CheckpointStore(filePath, 0);
        await reloaded.load();
        expect(reloaded.get('peerA:playlists')).toBe('2026-06-27T00:00:00.000Z');
        expect(reloaded.get('peerA:tracks')).toBe('2026-06-27T00:00:01.000Z');
    });

    it('returns null for unknown keys', async () => {
        const store = new CheckpointStore(filePath, 0);
        await store.load();
        expect(store.get('nope:playlists')).toBeNull();
    });

    it('overwrites an existing checkpoint', async () => {
        const store = new CheckpointStore(filePath, 0);
        await store.load();
        store.set('k', 'v1');
        store.set('k', 'v2');
        await store.flush();
        expect(store.get('k')).toBe('v2');
    });
});

describe('CheckpointStore graceful degradation', () => {
    it('starts empty when the file is absent (cold start → full resync)', async () => {
        const store = new CheckpointStore(path.join(tmpDir, 'does-not-exist.json'), 0);
        await store.load();
        expect(store.entries()).toEqual([]);
    });

    it('starts empty when the file is corrupt JSON, without throwing', async () => {
        fs.writeFileSync(filePath, '{ this is not json');
        const store = new CheckpointStore(filePath, 0);
        await expect(store.load()).resolves.toBeUndefined();
        expect(store.entries()).toEqual([]);
    });

    it('ignores non-string values in the persisted record', async () => {
        fs.writeFileSync(filePath, JSON.stringify({ good: 'x', bad: 123, nested: {} }));
        const store = new CheckpointStore(filePath, 0);
        await store.load();
        expect(store.get('good')).toBe('x');
        expect(store.get('bad')).toBeNull();
        expect(store.get('nested')).toBeNull();
    });

    it('does not crash flushing into an unwritable directory', async () => {
        const store = new CheckpointStore('/this/path/should/not/exist/ckpt.json', 0);
        await store.load();
        store.set('k', 'v');
        await expect(store.flush()).resolves.toBeUndefined();
    });
});

describe('CheckpointStore debounce', () => {
    it('coalesces rapid set() calls into a single write', async () => {
        const store = new CheckpointStore(filePath, 50);
        await store.load();
        store.set('a', '1');
        store.set('b', '2');
        store.set('c', '3');
        // Nothing written yet (debounce window still open).
        expect(fs.existsSync(filePath)).toBe(false);
        await new Promise((r) => setTimeout(r, 80));
        expect(fs.existsSync(filePath)).toBe(true);
        const written = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        expect(written).toEqual({ a: '1', b: '2', c: '3' });
    });

    it('set() with an unchanged value does not schedule a write', async () => {
        const store = new CheckpointStore(filePath, 10);
        await store.load();
        store.set('a', '1');
        await store.flush();
        // Remove file, then set the SAME value — no new write should occur.
        fs.rmSync(filePath);
        store.set('a', '1');
        await new Promise((r) => setTimeout(r, 30));
        expect(fs.existsSync(filePath)).toBe(false);
    });
});

describe('resolveCheckpointPath', () => {
    it('honors the WHATNEXT_CHECKPOINT_PATH override', () => {
        expect(resolveCheckpointPath({ WHATNEXT_CHECKPOINT_PATH: '/custom/ckpt.json' })).toBe(
            '/custom/ckpt.json'
        );
    });

    it('derives a WhatNext-scoped path under a config dir otherwise', () => {
        const resolved = resolveCheckpointPath({});
        expect(resolved).toMatch(/WhatNext/);
        expect(resolved.endsWith('replication-checkpoints.json')).toBe(true);
    });
});
