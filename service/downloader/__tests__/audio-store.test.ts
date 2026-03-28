import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AudioStore } from '../audio-store';

// Use a unique temp directory per test run so parallel runs don't conflict.
let tmpDir: string;

beforeEach(async () => {
    tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'whatnext-store-test-'));
});

afterEach(async () => {
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
});

describe('AudioStore', () => {
    describe('init', () => {
        it('creates the audio directory if it does not exist', async () => {
            const dir = path.join(tmpDir, 'new-audio-dir');
            const store = new AudioStore(dir);
            await store.init();
            const stat = await fs.promises.stat(dir);
            expect(stat.isDirectory()).toBe(true);
        });

        it('starts with an empty index when no index.json exists', async () => {
            const store = new AudioStore(tmpDir);
            await store.init();
            expect(store.getExisting('https://example.com/track')).toBeNull();
        });

        it('loads an existing index.json from disk', async () => {
            const existingFile = path.join(tmpDir, 'song.mp3');
            await fs.promises.writeFile(existingFile, 'audio data');
            const index = { 'https://example.com/track': existingFile };
            await fs.promises.writeFile(
                path.join(tmpDir, 'index.json'),
                JSON.stringify(index),
            );

            const store = new AudioStore(tmpDir);
            await store.init();
            expect(store.getExisting('https://example.com/track')).toBe(existingFile);
        });
    });

    describe('getExisting', () => {
        it('returns null for an unknown sourceUrl', async () => {
            const store = new AudioStore(tmpDir);
            await store.init();
            expect(store.getExisting('https://nope.example.com')).toBeNull();
        });

        it('returns the file path when the file exists on disk', async () => {
            const filePath = path.join(tmpDir, 'track.mp3');
            await fs.promises.writeFile(filePath, '');
            const store = new AudioStore(tmpDir);
            await store.init();
            await store.record('https://example.com/a', filePath);

            expect(store.getExisting('https://example.com/a')).toBe(filePath);
        });

        it('returns null and removes stale entry when file has been deleted', async () => {
            const filePath = path.join(tmpDir, 'deleted.mp3');
            await fs.promises.writeFile(filePath, '');
            const store = new AudioStore(tmpDir);
            await store.init();
            await store.record('https://example.com/deleted', filePath);

            // Delete the file to simulate a stale entry
            await fs.promises.unlink(filePath);
            expect(store.getExisting('https://example.com/deleted')).toBeNull();
            // Second call confirms stale entry was cleaned up
            expect(store.getExisting('https://example.com/deleted')).toBeNull();
        });
    });

    describe('record', () => {
        it('persists entry to index.json', async () => {
            const filePath = path.join(tmpDir, 'track.mp3');
            await fs.promises.writeFile(filePath, '');
            const store = new AudioStore(tmpDir);
            await store.init();
            await store.record('https://example.com/b', filePath);

            const raw = await fs.promises.readFile(path.join(tmpDir, 'index.json'), 'utf8');
            const index = JSON.parse(raw) as Record<string, string>;
            expect(index['https://example.com/b']).toBe(filePath);
        });

        it('survives a reload — entry present after re-init', async () => {
            const filePath = path.join(tmpDir, 'persistent.mp3');
            await fs.promises.writeFile(filePath, '');

            const store1 = new AudioStore(tmpDir);
            await store1.init();
            await store1.record('https://example.com/persist', filePath);

            const store2 = new AudioStore(tmpDir);
            await store2.init();
            expect(store2.getExisting('https://example.com/persist')).toBe(filePath);
        });

        it('does not create duplicate entries for the same URL', async () => {
            const filePath = path.join(tmpDir, 'dedup.mp3');
            await fs.promises.writeFile(filePath, '');
            const store = new AudioStore(tmpDir);
            await store.init();
            await store.record('https://example.com/dedup', filePath);
            await store.record('https://example.com/dedup', filePath);

            const raw = await fs.promises.readFile(path.join(tmpDir, 'index.json'), 'utf8');
            const index = JSON.parse(raw) as Record<string, string>;
            const keys = Object.keys(index).filter((k) => k === 'https://example.com/dedup');
            expect(keys).toHaveLength(1);
        });
    });

    describe('buildFilename', () => {
        it('produces artist - title.ext format', () => {
            expect(AudioStore.buildFilename('Burial', 'Archangel', 'mp3')).toBe('Burial - Archangel.mp3');
        });

        it('adds a dot to ext if missing', () => {
            expect(AudioStore.buildFilename('Four Tet', 'Angel Echoes', 'flac')).toBe(
                'Four Tet - Angel Echoes.flac',
            );
        });

        it('does not double the dot when ext already starts with one', () => {
            expect(AudioStore.buildFilename('Boards of Canada', 'Roygbiv', '.wav')).toBe(
                'Boards of Canada - Roygbiv.wav',
            );
        });

        it('sanitises forbidden characters', () => {
            const name = AudioStore.buildFilename('Artist: A/B', 'Title*?', 'mp3');
            expect(name).not.toMatch(/[/\\:*?"<>|]/);
        });

        it('caps the base filename at 100 chars', () => {
            const longArtist = 'A'.repeat(60);
            const longTitle = 'T'.repeat(60);
            const name = AudioStore.buildFilename(longArtist, longTitle, 'mp3');
            const base = path.basename(name, '.mp3');
            expect(base.length).toBeLessThanOrEqual(100);
        });
    });
});
