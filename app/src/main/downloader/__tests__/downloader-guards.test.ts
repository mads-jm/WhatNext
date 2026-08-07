/**
 * Downloader guards — trust-boundary tests for the renderer strings that become argv
 * for a spawned downloader binary.
 *
 * These import the *shipped* guards (no re-implementation of handler logic here) and
 * run the backend-path check against real temp files, so a regression in the argv
 * hygiene or in the dialog-authority bookkeeping fails here.
 */

import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';

// `ipc-guards` (imported transitively for the dialog record) pulls in electron.
const userDataDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'wn-dlguard-userdata-'),
);
vi.mock('electron', () => ({ app: { getPath: () => userDataDir } }));

import {
    DownloadInputError,
    validateBackendPathRequest,
    validateResolveInput,
    validateSourceUrl,
} from '../downloader-guards';
import { recordApprovedOpenFile } from '../../ipc-guards';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wn-dlguard-'));
const fakeBinary = path.join(tmpDir, 'yt-dlp');
const someDir = path.join(tmpDir, 'a-directory');
fs.writeFileSync(fakeBinary, '#!/bin/sh\n');
fs.mkdirSync(someDir, { recursive: true });

afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.rmSync(userDataDir, { recursive: true, force: true });
});

/** A confirm stub that records whether it was reached. */
function confirmStub(answer: boolean) {
    return vi.fn(async () => answer);
}

// ---------------------------------------------------------------------------
// download:start — per-track source URLs
// ---------------------------------------------------------------------------

describe('validateSourceUrl', () => {
    it("accepts http(s) links and hands back the caller's exact string", () => {
        // Not URL.href: the renderer correlates download events by the string it sent,
        // so a normalised URL would orphan every progress/error event for the track.
        const raw = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
        expect(validateSourceUrl(raw)).toEqual({ ok: true, url: raw });
        expect(validateSourceUrl('http://example.com/a')).toEqual({
            ok: true,
            url: 'http://example.com/a',
        });
    });

    // The whole point of the lane: yt-dlp/spotDL parse a leading-dash positional as an
    // option, so these are command execution / arbitrary writes, not bad URLs.
    it.each([
        '--exec=touch /tmp/pwned',
        '--exec',
        '-o/tmp/pwned.mp3',
        '--config-location=/tmp/evil.conf',
        '-x',
        '--',
    ])('rejects the option-looking argument %j', (hostile) => {
        expect(validateSourceUrl(hostile).ok).toBe(false);
    });

    it('rejects non-http protocols that would still reach argv', () => {
        expect(validateSourceUrl('file:///etc/passwd').ok).toBe(false);
        expect(
            validateSourceUrl('spotify:track:1IHWl5LamUGEuP4ozKQSXZ').ok,
        ).toBe(false);
        expect(validateSourceUrl('javascript:alert(1)').ok).toBe(false);
    });

    it('rejects empty, non-string, control-character and oversized input', () => {
        expect(validateSourceUrl('').ok).toBe(false);
        expect(validateSourceUrl(undefined).ok).toBe(false);
        expect(validateSourceUrl(42).ok).toBe(false);
        expect(validateSourceUrl('https://x.com/a\n--exec=sh').ok).toBe(false);
        expect(validateSourceUrl(`https://x.com/${'a'.repeat(4000)}`).ok).toBe(
            false,
        );
    });
});

// ---------------------------------------------------------------------------
// download:resolve — both live input branches
// ---------------------------------------------------------------------------

describe('validateResolveInput', () => {
    it('accepts a url input', () => {
        expect(
            validateResolveInput({
                type: 'url',
                url: 'https://open.spotify.com/playlist/abc',
            }),
        ).toEqual({ ok: true });
    });

    it('accepts spotify-ids — the library download branch', () => {
        // Regression guard: this branch is live (useLibraryDownload) and a URL-only
        // check would have broken it. Ids become https://open.spotify.com/track/<id>.
        expect(
            validateResolveInput({
                type: 'spotify-ids',
                spotifyIds: [
                    '1IHWl5LamUGEuP4ozKQSXZ',
                    '4uLU6hMCjMI75M1A2tKUQC',
                ],
            }),
        ).toEqual({ ok: true });
    });

    it('rejects a hostile url input before any backend is constructed', () => {
        expect(
            validateResolveInput({ type: 'url', url: '--exec=calc' }).ok,
        ).toBe(false);
        expect(validateResolveInput({ type: 'url' }).ok).toBe(false);
    });

    it('rejects ids that are not Spotify base62 ids', () => {
        expect(
            validateResolveInput({ type: 'spotify-ids', spotifyIds: [] }).ok,
        ).toBe(false);
        expect(
            validateResolveInput({
                type: 'spotify-ids',
                spotifyIds: ['../../etc/passwd'],
            }).ok,
        ).toBe(false);
        expect(
            validateResolveInput({ type: 'spotify-ids', spotifyIds: ['short'] })
                .ok,
        ).toBe(false);
        expect(
            validateResolveInput({
                type: 'spotify-ids',
                spotifyIds: [
                    '1IHWl5LamUGEuP4ozKQSXZ',
                    'not a valid id here!!!',
                ],
            }).ok,
        ).toBe(false);
    });

    it('rejects unknown or missing input shapes', () => {
        expect(validateResolveInput(undefined).ok).toBe(false);
        expect(validateResolveInput('https://example.com').ok).toBe(false);
        expect(validateResolveInput({ type: 'shell' }).ok).toBe(false);
    });

    it('names the offending value in the error so a rejection is diagnosable', () => {
        const check = validateResolveInput({ type: 'url', url: 'notaurl' });
        expect(check.ok).toBe(false);
        expect(
            new DownloadInputError((check as { error: string }).error).message,
        ).toContain('notaurl');
    });
});

// ---------------------------------------------------------------------------
// download:set-backend-path — hybrid authority model
// ---------------------------------------------------------------------------

describe('validateBackendPathRequest', () => {
    beforeEach(() => vi.clearAllMocks());

    it('accepts a dialog-returned path with no confirmation prompt', async () => {
        recordApprovedOpenFile(fakeBinary);
        const confirm = confirmStub(false);

        const decision = await validateBackendPathRequest(
            { id: 'ytdlp', path: fakeBinary },
            confirm,
        );

        expect(decision).toEqual({ ok: true, id: 'ytdlp', path: fakeBinary });
        expect(confirm).not.toHaveBeenCalled();
    });

    it('ignores a renderer claim that a path came from the dialog', async () => {
        // Trust comes from main's own record of what the dialog returned; a field the
        // renderer sets is forgeable, so it must not shortcut the prompt.
        const confirm = confirmStub(true);
        const unrecorded = path.join(tmpDir, 'spotdl');
        fs.writeFileSync(unrecorded, '#!/bin/sh\n');

        const decision = await validateBackendPathRequest(
            {
                id: 'spotdl',
                path: unrecorded,
                fromDialog: true,
                approved: true,
            },
            confirm,
        );

        expect(confirm).toHaveBeenCalledWith(unrecorded);
        expect(decision).toEqual({ ok: true, id: 'spotdl', path: unrecorded });
    });

    it('accepts a hand-typed path once the user confirms it', async () => {
        const typed = path.join(tmpDir, 'typed-ytdlp');
        fs.writeFileSync(typed, '#!/bin/sh\n');
        const confirm = confirmStub(true);

        const decision = await validateBackendPathRequest(
            { id: 'ytdlp', path: typed },
            confirm,
        );

        expect(confirm).toHaveBeenCalledTimes(1);
        expect(decision).toEqual({ ok: true, id: 'ytdlp', path: typed });
    });

    it('reports a declined confirmation as declined, not as an error', async () => {
        const typed = path.join(tmpDir, 'declined-ytdlp');
        fs.writeFileSync(typed, '#!/bin/sh\n');

        const decision = await validateBackendPathRequest(
            { id: 'ytdlp', path: typed },
            confirmStub(false),
        );

        // ok:false means the caller never calls setBackendPath — the previous value
        // survives and nothing is spawned.
        expect(decision).toEqual({ ok: false, reason: 'declined' });
    });

    it('refuses a path that does not exist, without prompting', async () => {
        const confirm = confirmStub(true);
        const decision = await validateBackendPathRequest(
            { id: 'ytdlp', path: path.join(tmpDir, 'nope', 'yt-dlp') },
            confirm,
        );

        expect(decision).toMatchObject({ ok: false, reason: 'invalid' });
        expect((decision as { error: string }).error).toContain('No such file');
        expect(confirm).not.toHaveBeenCalled();
    });

    it('refuses a directory, without prompting', async () => {
        const confirm = confirmStub(true);
        const decision = await validateBackendPathRequest(
            { id: 'ytdlp', path: someDir },
            confirm,
        );

        expect(decision).toMatchObject({ ok: false, reason: 'invalid' });
        expect((decision as { error: string }).error).toContain(
            'Not a program file',
        );
        expect(confirm).not.toHaveBeenCalled();
    });

    it('refuses a relative path and an unknown backend id', async () => {
        const confirm = confirmStub(true);
        expect(
            await validateBackendPathRequest(
                { id: 'ytdlp', path: './yt-dlp' },
                confirm,
            ),
        ).toMatchObject({ ok: false, reason: 'invalid' });
        expect(
            await validateBackendPathRequest(
                { id: 'rm-rf', path: fakeBinary },
                confirm,
            ),
        ).toMatchObject({ ok: false, reason: 'invalid' });
        expect(await validateBackendPathRequest(null, confirm)).toMatchObject({
            ok: false,
            reason: 'invalid',
        });
        expect(confirm).not.toHaveBeenCalled();
    });

    it('clears a path with no confirmation — clearing reduces privilege', async () => {
        const confirm = confirmStub(false);

        for (const value of [null, undefined, '   ']) {
            const decision = await validateBackendPathRequest(
                { id: 'spotdl', path: value },
                confirm,
            );
            expect(decision).toEqual({ ok: true, id: 'spotdl', path: null });
        }
        expect(confirm).not.toHaveBeenCalled();
    });
});
