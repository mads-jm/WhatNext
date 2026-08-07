import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';

// Point the store's userData dir at a real temp dir and stub electron. The
// factory runs when the store first imports 'electron', by which time `tmpDir`
// (declared above) is initialised.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wn-dl-cfg-'));
vi.mock('electron', () => ({ app: { getPath: () => tmpDir } }));

import {
    getBackendPath,
    getBackendPaths,
    setBackendPath,
} from '../downloader-config-store';

const configFile = path.join(tmpDir, 'downloader-config.json');

beforeEach(() => {
    if (fs.existsSync(configFile)) fs.unlinkSync(configFile);
});

describe('downloader-config-store', () => {
    it('returns an empty map when no config file exists', () => {
        expect(getBackendPaths()).toEqual({});
        expect(getBackendPath('ytdlp')).toBeUndefined();
    });

    it('persists and reads back a custom path', () => {
        setBackendPath('ytdlp', '/opt/bin/yt-dlp');
        expect(getBackendPath('ytdlp')).toBe('/opt/bin/yt-dlp');
        expect(getBackendPaths()).toEqual({ ytdlp: '/opt/bin/yt-dlp' });
        // Written to disk so the main process reads it on next launch.
        expect(fs.existsSync(configFile)).toBe(true);
    });

    it('trims whitespace around a stored path', () => {
        setBackendPath('spotdl', '  /usr/local/bin/spotdl  ');
        expect(getBackendPath('spotdl')).toBe('/usr/local/bin/spotdl');
    });

    it('clears a path when given null or blank', () => {
        setBackendPath('spotdl', '/x/spotdl');
        expect(setBackendPath('spotdl', null)).toEqual({});
        expect(getBackendPath('spotdl')).toBeUndefined();

        setBackendPath('spotdl', '/x/spotdl');
        setBackendPath('spotdl', '   ');
        expect(getBackendPath('spotdl')).toBeUndefined();
    });

    it('ignores unknown backend ids', () => {
        expect(setBackendPath('bogus', '/x')).toEqual({});
        expect(getBackendPath('bogus')).toBeUndefined();
    });

    it('drops unknown / blank entries when reading a hand-edited file', () => {
        fs.writeFileSync(
            configFile,
            JSON.stringify({
                paths: { ytdlp: '/a', bogus: '/b', spotdl: '   ' },
            }),
            'utf-8',
        );
        expect(getBackendPaths()).toEqual({ ytdlp: '/a' });
    });

    it('recovers from a corrupt config file', () => {
        fs.writeFileSync(configFile, 'not json', 'utf-8');
        expect(getBackendPaths()).toEqual({});
    });

    it('keeps independent paths per backend', () => {
        setBackendPath('ytdlp', '/a/yt-dlp');
        setBackendPath('spytify', 'C:\\tools\\spytify.exe');
        expect(getBackendPaths()).toEqual({
            ytdlp: '/a/yt-dlp',
            spytify: 'C:\\tools\\spytify.exe',
        });
    });
});
