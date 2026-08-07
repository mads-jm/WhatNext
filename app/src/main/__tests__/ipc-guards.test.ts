/**
 * IPC Guards — trust-boundary tests for the renderer entry points in main.ts.
 *
 * These import the *shipped* guard functions (no re-implementation of handler logic
 * in the test file) and run them against real temp directories, so a regression in
 * containment or approval bookkeeping fails here.
 */

import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';

// Real temp dirs stand in for the two Electron path roots the guards consult.
// The factory runs when the guards first import 'electron', by which time these
// are initialised.
const userDataDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'wn-guard-userdata-'),
);
const documentsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wn-guard-docs-'));
vi.mock('electron', () => ({
    app: {
        getPath: (name: string) => {
            if (name === 'documents') return documentsDir;
            return userDataDir;
        },
    },
}));

import {
    validateExternalUrl,
    resolveArtworkPath,
    getArtworkRoots,
    recordApprovedSaveTarget,
    consumeApprovedSaveTarget,
    validateOpenPathRequest,
} from '../ipc-guards';
import { recordApprovedDirectory } from '../approved-dirs-store';

const artworkDir = path.join(documentsDir, 'WhatNext', 'artwork');
const legacyArtworkDir = path.join(userDataDir, 'artwork');
const audioDir = path.join(documentsDir, 'WhatNext', 'audio');
const approvedDirsFile = path.join(userDataDir, 'approved-dirs.json');

fs.mkdirSync(artworkDir, { recursive: true });
fs.mkdirSync(legacyArtworkDir, { recursive: true });
fs.mkdirSync(audioDir, { recursive: true });

afterAll(() => {
    fs.rmSync(userDataDir, { recursive: true, force: true });
    fs.rmSync(documentsDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// shell:open-external
// ---------------------------------------------------------------------------

describe('validateExternalUrl', () => {
    it('accepts http and https links and hands back the normalised href', () => {
        expect(
            validateExternalUrl('https://open.spotify.com/playlist/abc'),
        ).toEqual({
            ok: true,
            url: 'https://open.spotify.com/playlist/abc',
        });
        expect(validateExternalUrl('http://localhost:1313/docs')).toEqual({
            ok: true,
            url: 'http://localhost:1313/docs',
        });
    });

    it('accepts a bare spotify: URI and a well-formed context URI', () => {
        expect(validateExternalUrl('spotify:')).toEqual({
            ok: true,
            url: 'spotify:',
        });
        expect(
            validateExternalUrl('spotify:playlist:37i9dQZF1DXcBWIGoYBM5M'),
        ).toEqual({ ok: true, url: 'spotify:playlist:37i9dQZF1DXcBWIGoYBM5M' });
        expect(
            validateExternalUrl('spotify:user:mads:playlist:abc123'),
        ).toEqual({
            ok: true,
            url: 'spotify:user:mads:playlist:abc123',
        });
    });

    it('rejects a shell-injection payload dressed as a spotify URI', () => {
        // The exact shape that used to reach `exec("start \"\" <url>")`.
        for (const payload of [
            'spotify:" & calc & "',
            'spotify:track:abc" & calc & "',
            'spotify:track:abc; rm -rf ~',
            'spotify:track:abc`whoami`',
            'spotify:track:abc$(id)',
            'spotify:track:abc|nc attacker 1234',
        ]) {
            expect(validateExternalUrl(payload)).toEqual({
                ok: false,
                error: 'Malformed URI',
            });
        }
    });

    it('rejects protocols outside the allowlist', () => {
        for (const url of [
            'file:///etc/passwd',
            'javascript:alert(1)',
            'data:text/html,<script>1</script>',
            'vbscript:msgbox',
            'whtnxt://connect/abc',
        ]) {
            expect(validateExternalUrl(url)).toEqual({
                ok: false,
                error: 'Invalid protocol',
            });
        }
    });

    it('rejects non-strings, blanks, control characters and absurd lengths', () => {
        expect(validateExternalUrl(undefined)).toEqual({
            ok: false,
            error: 'Invalid URL',
        });
        expect(validateExternalUrl(42)).toEqual({
            ok: false,
            error: 'Invalid URL',
        });
        expect(validateExternalUrl('')).toEqual({
            ok: false,
            error: 'Invalid URL',
        });
        expect(validateExternalUrl('not a url')).toEqual({
            ok: false,
            error: 'Invalid URL',
        });
        expect(
            validateExternalUrl('https://example.com/\n\rSet-Cookie: x'),
        ).toEqual({
            ok: false,
            error: 'Invalid URL',
        });
        expect(
            validateExternalUrl(`https://example.com/${'a'.repeat(4000)}`),
        ).toEqual({
            ok: false,
            error: 'Invalid URL',
        });
    });

    it('keeps main.ts free of any process-spawning API on this path', () => {
        // Regression lock for the removed `exec('start "" <url>')` branch: the whole
        // handler now runs through shell.openExternal, so main.ts must not reach for a
        // shell at all. Cheaper and more direct than booting Electron to observe it.
        // (vitest runs with cwd = app/; assert that before trusting the read.)
        const mainPath = path.resolve(process.cwd(), 'src/main/main.ts');
        expect(fs.existsSync(mainPath)).toBe(true);
        const mainSource = fs.readFileSync(mainPath, 'utf-8');
        expect(mainSource).not.toMatch(/child_process/);
        expect(mainSource).not.toMatch(
            /\bexec\(|execSync|execFileSync|execFile\(/,
        );
    });
});

// ---------------------------------------------------------------------------
// wn-art://
// ---------------------------------------------------------------------------

describe('resolveArtworkPath', () => {
    it('enumerates both the current and the legacy artwork root', () => {
        expect(getArtworkRoots()).toEqual([artworkDir, legacyArtworkDir]);
    });

    it('serves an image inside the documents artwork cache', () => {
        const file = path.join(artworkDir, 'Artist - Album.jpg');
        expect(resolveArtworkPath(file)).toBe(file);
    });

    it('serves an image inside the legacy userData artwork cache', () => {
        const file = path.join(legacyArtworkDir, 'cover.png');
        expect(resolveArtworkPath(file)).toBe(file);
    });

    it('rejects relative traversal out of the artwork root', () => {
        expect(
            resolveArtworkPath(
                path.join(artworkDir, '..', '..', '..', 'secrets.jpg'),
            ),
        ).toBeNull();
        expect(
            resolveArtworkPath(`${artworkDir}/../../../../etc/shadow.png`),
        ).toBeNull();
    });

    it('rejects absolute paths that were never under an artwork root', () => {
        expect(resolveArtworkPath('/etc/passwd')).toBeNull();
        expect(resolveArtworkPath('/etc/passwd.jpg')).toBeNull();
        expect(
            resolveArtworkPath(path.join(os.homedir(), '.ssh', 'id_rsa.png')),
        ).toBeNull();
        // A peer-replicated doc carrying *their* local path must not read *our* disk.
        expect(resolveArtworkPath('/home/peer/art/song.jpg')).toBeNull();
    });

    it('rejects a sibling directory that merely shares the root prefix', () => {
        expect(
            resolveArtworkPath(`${artworkDir}-backup${path.sep}cover.jpg`),
        ).toBeNull();
    });

    it('rejects non-image files even inside the artwork root', () => {
        // index.json lives here; the protocol is for images only.
        expect(
            resolveArtworkPath(path.join(artworkDir, 'index.json')),
        ).toBeNull();
        expect(
            resolveArtworkPath(path.join(artworkDir, 'payload.html')),
        ).toBeNull();
    });

    it('rejects relative paths, blanks, non-strings and NUL injection', () => {
        expect(resolveArtworkPath('artwork/cover.jpg')).toBeNull();
        expect(resolveArtworkPath('')).toBeNull();
        expect(resolveArtworkPath(undefined)).toBeNull();
        expect(
            resolveArtworkPath(path.join(artworkDir, 'cover.jpg\0.txt')),
        ).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// file:write
// ---------------------------------------------------------------------------

describe('save-target approval (file:write)', () => {
    it('approves exactly one write per save dialog', () => {
        const target = path.join(documentsDir, 'playlist-export.md');
        recordApprovedSaveTarget(target);
        expect(consumeApprovedSaveTarget(target)).toBe(true);
        // Second write with the same captured path is no longer approved.
        expect(consumeApprovedSaveTarget(target)).toBe(false);
    });

    it('refuses a path the user never chose in a dialog', () => {
        expect(consumeApprovedSaveTarget('/etc/cron.d/pwn')).toBe(false);
        expect(
            consumeApprovedSaveTarget(path.join(os.homedir(), '.bashrc')),
        ).toBe(false);
    });

    it('matches the approved path after normalisation, not by raw string', () => {
        const target = path.join(documentsDir, 'theme.json');
        recordApprovedSaveTarget(target);
        expect(
            consumeApprovedSaveTarget(
                path.join(documentsDir, '.', 'theme.json'),
            ),
        ).toBe(true);
    });

    it('does not let a traversal past an approved path smuggle a different file', () => {
        const target = path.join(documentsDir, 'theme.json');
        recordApprovedSaveTarget(target);
        expect(
            consumeApprovedSaveTarget(
                path.join(documentsDir, 'sub', '..', 'other.json'),
            ),
        ).toBe(false);
        // The genuine approval is untouched by the failed attempt.
        expect(consumeApprovedSaveTarget(target)).toBe(true);
    });

    it('refuses non-strings and blanks', () => {
        expect(consumeApprovedSaveTarget(undefined)).toBe(false);
        expect(consumeApprovedSaveTarget('')).toBe(false);
        expect(consumeApprovedSaveTarget('   ')).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// shell:open-path
// ---------------------------------------------------------------------------

describe('validateOpenPathRequest', () => {
    beforeEach(() => {
        if (fs.existsSync(approvedDirsFile)) fs.unlinkSync(approvedDirsFile);
    });

    it('allows the app-owned database and artwork directories', async () => {
        await expect(validateOpenPathRequest(userDataDir)).resolves.toEqual({
            ok: true,
            path: fs.realpathSync(userDataDir),
        });
        await expect(validateOpenPathRequest(artworkDir)).resolves.toEqual({
            ok: true,
            path: fs.realpathSync(artworkDir),
        });
        await expect(validateOpenPathRequest(audioDir)).resolves.toEqual({
            ok: true,
            path: fs.realpathSync(audioDir),
        });
    });

    it('allows a directory only after the user picked it in a main-process dialog', async () => {
        const exportDir = fs.mkdtempSync(
            path.join(os.tmpdir(), 'wn-guard-export-'),
        );
        try {
            const before = await validateOpenPathRequest(exportDir);
            expect(before).toEqual({
                ok: false,
                error: 'Directory not permitted',
            });

            recordApprovedDirectory(exportDir);

            await expect(validateOpenPathRequest(exportDir)).resolves.toEqual({
                ok: true,
                path: fs.realpathSync(exportDir),
            });
        } finally {
            fs.rmSync(exportDir, { recursive: true, force: true });
        }
    });

    it('refuses a regular file, even inside an approved directory', async () => {
        // shell.openPath on a file launches it with the OS handler — execution for
        // .desktop/.bat/.exe. Directories only.
        const launcher = path.join(userDataDir, 'evil.desktop');
        fs.writeFileSync(launcher, '[Desktop Entry]\nExec=calc\n');
        await expect(validateOpenPathRequest(launcher)).resolves.toEqual({
            ok: false,
            error: 'Not a directory',
        });
        fs.unlinkSync(launcher);
    });

    it('refuses a directory outside every permitted root', async () => {
        await expect(validateOpenPathRequest(os.tmpdir())).resolves.toEqual({
            ok: false,
            error: 'Directory not permitted',
        });
        await expect(validateOpenPathRequest(os.homedir())).resolves.toEqual({
            ok: false,
            error: 'Directory not permitted',
        });
    });

    it('refuses a sibling directory sharing an app-root prefix', async () => {
        const sibling = `${path.join(documentsDir, 'WhatNext')}Extra`;
        fs.mkdirSync(sibling, { recursive: true });
        try {
            await expect(validateOpenPathRequest(sibling)).resolves.toEqual({
                ok: false,
                error: 'Directory not permitted',
            });
        } finally {
            fs.rmSync(sibling, { recursive: true, force: true });
        }
    });

    it('refuses traversal out of an app root', async () => {
        await expect(
            validateOpenPathRequest(path.join(artworkDir, '..', '..', '..')),
        ).resolves.toEqual({ ok: false, error: 'Directory not permitted' });
    });

    it('refuses non-existent, relative, blank and non-string paths', async () => {
        await expect(
            validateOpenPathRequest(path.join(userDataDir, 'no-such-dir')),
        ).resolves.toEqual({ ok: false, error: 'Directory not found' });
        await expect(validateOpenPathRequest('relative/dir')).resolves.toEqual({
            ok: false,
            error: 'Invalid path',
        });
        await expect(validateOpenPathRequest('')).resolves.toEqual({
            ok: false,
            error: 'Invalid path',
        });
        await expect(validateOpenPathRequest(undefined)).resolves.toEqual({
            ok: false,
            error: 'Invalid path',
        });
    });

    it('survives a hand-mangled approvals file without granting anything', async () => {
        fs.writeFileSync(approvedDirsFile, '{ not json');
        await expect(validateOpenPathRequest(os.tmpdir())).resolves.toEqual({
            ok: false,
            error: 'Directory not permitted',
        });
    });
});
