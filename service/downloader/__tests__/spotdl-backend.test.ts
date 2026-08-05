import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../subprocess', async (orig) => {
    const actual = await orig<typeof import('../subprocess')>();
    return {
        ...actual,
        runCommand: vi.fn(),
        spawnLines: vi.fn(),
        killProcess: vi.fn(),
    };
});

import { runCommand, spawnLines, killProcess } from '../subprocess';
import { SpotdlBackend, SpotdlResolveError } from '../backends/spotdl-backend';
import type { DownloadEvent, ResolvedTrack } from '../types';
import { makeRunResult, makeSpawnLines, makeBlockingSpawnLines } from './helpers/fixture-process';
import { loadFixtureLines, loadFixtureText } from './helpers/load-fixture';

const OUT = '/home/u/WhatNext/audio';
const SPOTIFY_URL = 'https://open.spotify.com/track/1IHWl5LamUGEuP4ozKQSXZ';

function spotifyTrack(): ResolvedTrack {
    return {
        sourceId: '1IHWl5LamUGEuP4ozKQSXZ',
        sourceUrl: SPOTIFY_URL,
        sourceProvider: 'spotify',
        title: '',
        artists: [],
        album: '',
        durationMs: 0,
        availableFormats: [],
    };
}

async function collect(gen: AsyncGenerator<DownloadEvent>): Promise<DownloadEvent[]> {
    const out: DownloadEvent[] = [];
    for await (const e of gen) out.push(e);
    return out;
}

beforeEach(() => vi.clearAllMocks());

describe('SpotdlBackend capability declaration', () => {
    it('declares the spotify-ids input that DownloadInput actually uses (regression)', () => {
        // Latent bug fix: the singular "spotify-id" could never be selected by a
        // real DownloadInput whose union is 'url' | 'spotify-ids'.
        expect(new SpotdlBackend().supportedInputs).toContain('spotify-ids');
    });

    it('resolves spotify-ids input into Spotify track URLs', async () => {
        vi.mocked(runCommand).mockResolvedValue(
            makeRunResult({ code: 0, stdout: loadFixtureText('spotdl-save.json') }),
        );
        const tracks = await new SpotdlBackend().resolve({
            type: 'spotify-ids',
            spotifyIds: ['1IHWl5LamUGEuP4ozKQSXZ'],
        });
        expect(tracks).toHaveLength(1);
        expect(vi.mocked(runCommand).mock.calls[0][1]).toEqual([
            'save',
            'https://open.spotify.com/track/1IHWl5LamUGEuP4ozKQSXZ',
            '--save-file',
            '-',
        ]);
    });
});

describe('SpotdlBackend.resolve', () => {
    it('maps the save-file JSON into a ResolvedTrack', async () => {
        vi.mocked(runCommand).mockResolvedValue(
            makeRunResult({ code: 0, stdout: loadFixtureText('spotdl-save.json') }),
        );
        const [t] = await new SpotdlBackend().resolve({ type: 'url', url: SPOTIFY_URL });
        expect(t).toMatchObject({
            title: 'Strobe',
            artists: ['deadmau5'],
            album: 'For Lack of a Better Name',
            durationMs: 634_000,
            sourceProvider: 'spotify',
            spotifyId: '1IHWl5LamUGEuP4ozKQSXZ',
        });
    });

    // #56 regression: unreadable save output used to become a stub track whose
    // title was the URL — a junk library entry that looked like a real import.
    it('fails the resolve when stdout is not parseable JSON (captured bad output)', async () => {
        const raw = loadFixtureText('spotdl-save-unreadable.stdout.txt');
        vi.mocked(runCommand).mockResolvedValue(makeRunResult({ code: 0, stdout: raw }));

        const resolving = new SpotdlBackend().resolve({ type: 'url', url: SPOTIFY_URL });

        await expect(resolving).rejects.toBeInstanceOf(SpotdlResolveError);
        // The instanceof assertion above proves the cast; `.catch` alone would
        // type `err` as `ResolvedTrack[] | SpotdlResolveError`.
        const err = (await resolving.catch((e: unknown) => e)) as SpotdlResolveError;
        // Raw output is retained for debugging, and excerpted into the message
        // (the only part that survives the IPC rejection boundary).
        expect(err.rawOutput).toBe(raw);
        expect(err.message).toContain(SPOTIFY_URL);
        expect(err.message).toContain('LookupError');
    });

    it('fails the resolve when stdout parses to something that is not a track list', async () => {
        vi.mocked(runCommand).mockResolvedValue(
            makeRunResult({ code: 0, stdout: '{"error":"unauthorized"}' }),
        );
        await expect(
            new SpotdlBackend().resolve({ type: 'url', url: SPOTIFY_URL }),
        ).rejects.toBeInstanceOf(SpotdlResolveError);
    });

    it('reports empty output rather than an empty excerpt', async () => {
        vi.mocked(runCommand).mockResolvedValue(makeRunResult({ code: 0, stdout: '   ' }));
        await expect(
            new SpotdlBackend().resolve({ type: 'url', url: SPOTIFY_URL }),
        ).rejects.toThrow('(no output)');
    });
});

describe('SpotdlBackend argv hygiene', () => {
    // spotDL cannot take a `--` separator: `spotdl save --save-file - -- <url>` answers
    // "unrecognized arguments: --" (verified against the real spotDL 4.5.2), and the
    // alternative placements fail too. So the second layer behind the IPC guard is a
    // shape check on the query argument instead. These tests pin both halves.
    it('keeps the argv shape spotDL actually accepts (no -- separator)', async () => {
        vi.mocked(runCommand).mockResolvedValue(
            makeRunResult({ code: 0, stdout: loadFixtureText('spotdl-save.json') }),
        );

        await new SpotdlBackend().resolve({ type: 'url', url: SPOTIFY_URL });

        const args = vi.mocked(runCommand).mock.calls[0][1];
        expect(args).toEqual(['save', SPOTIFY_URL, '--save-file', '-']);
        expect(args).not.toContain('--');
    });

    it('refuses an option-looking query argument before spawning (resolve)', async () => {
        await expect(
            new SpotdlBackend().resolve({ type: 'url', url: '--exec=touch /tmp/pwned' }),
        ).rejects.toThrow('non-http(s) query argument');
        // Nothing was spawned: the batch is refused up front, not half-resolved.
        expect(vi.mocked(runCommand)).not.toHaveBeenCalled();
    });

    it('refuses an option-looking query argument before spawning (download)', async () => {
        const hostile = { ...spotifyTrack(), sourceUrl: '--config-location=/tmp/evil.conf' };

        const events = await collect(
            new SpotdlBackend().download([hostile], { outputDir: OUT, preferredFormat: 'mp3' }),
        );

        expect(events).toHaveLength(1);
        expect(events[0].type).toBe('error');
        expect(events[0].error).toContain('non-http(s) query argument');
        expect(vi.mocked(spawnLines)).not.toHaveBeenCalled();
    });
});

describe('SpotdlBackend.download', () => {
    it('parses progress and the Downloaded path on success', async () => {
        vi.mocked(spawnLines).mockReturnValue(
            makeSpawnLines(loadFixtureLines('spotdl-success.stdout.txt'), { exitCode: 0 }),
        );
        const events = await collect(
            new SpotdlBackend().download([spotifyTrack()], { outputDir: OUT, preferredFormat: 'mp3' }),
        );
        expect(events.some((e) => e.type === 'progress' && e.percent === 37)).toBe(true);
        const complete = events.at(-1)!;
        expect(complete.type).toBe('complete');
        expect(complete.localFilePath).toBe(`${OUT}/deadmau5 - Strobe.mp3`);
    });

    it('maps a cache-skip line to a complete event with the existing path', async () => {
        vi.mocked(spawnLines).mockReturnValue(
            makeSpawnLines(loadFixtureLines('spotdl-skip.stdout.txt'), { exitCode: 0 }),
        );
        const events = await collect(
            new SpotdlBackend().download([spotifyTrack()], { outputDir: OUT, preferredFormat: 'mp3' }),
        );
        const complete = events.at(-1)!;
        expect(complete.type).toBe('complete');
        expect(complete.localFilePath).toBe(`${OUT}/deadmau5 - Strobe.mp3`);
    });

    it('does NOT fail on benign "error" text in stderr when exit code is 0', async () => {
        vi.mocked(spawnLines).mockReturnValue(
            makeSpawnLines(loadFixtureLines('spotdl-success.stdout.txt'), {
                stderr: loadFixtureText('spotdl-benign.stderr.txt'),
                exitCode: 0,
            }),
        );
        const events = await collect(
            new SpotdlBackend().download([spotifyTrack()], { outputDir: OUT, preferredFormat: 'mp3' }),
        );
        expect(events.at(-1)!.type).toBe('complete');
    });

    it('fails on a non-zero exit code', async () => {
        vi.mocked(spawnLines).mockReturnValue(
            makeSpawnLines([], { stderr: 'AudioProviderError: no match', exitCode: 1 }),
        );
        const events = await collect(
            new SpotdlBackend().download([spotifyTrack()], { outputDir: OUT, preferredFormat: 'mp3' }),
        );
        expect(events).toHaveLength(1);
        expect(events[0].type).toBe('error');
        expect(events[0].error).toContain('AudioProviderError');
    });
});

describe('SpotdlBackend.checkInstalled', () => {
    it('reports installed/version on clean exit', async () => {
        vi.mocked(runCommand).mockResolvedValue(makeRunResult({ code: 0, stdout: '4.2.5' }));
        expect(await new SpotdlBackend().checkInstalled()).toMatchObject({
            installed: true,
            version: '4.2.5',
        });
    });

    it('reports not installed on spawn error', async () => {
        vi.mocked(runCommand).mockRejectedValue(new Error('spawn spotdl ENOENT'));
        expect((await new SpotdlBackend().checkInstalled()).installed).toBe(false);
    });

    it('reports not installed on non-zero exit', async () => {
        vi.mocked(runCommand).mockResolvedValue(makeRunResult({ code: 1, stderr: 'bad' }));
        expect((await new SpotdlBackend().checkInstalled()).installed).toBe(false);
    });

    it('uses a configured custom path', async () => {
        vi.mocked(runCommand).mockResolvedValue(makeRunResult({ code: 0, stdout: '4.2.5' }));
        const status = await new SpotdlBackend('/opt/pipx/spotdl').checkInstalled();
        expect(status.path).toBe('/opt/pipx/spotdl');
        expect(vi.mocked(runCommand).mock.calls[0][0]).toBe('/opt/pipx/spotdl');
    });
});

describe('SpotdlBackend.cancel', () => {
    it('kills the active process mid-download', async () => {
        const { result, release } = makeBlockingSpawnLines([
            '[download]  20.0% of 9.60MiB at 1.00MiB/s ETA 00:08',
        ]);
        vi.mocked(spawnLines).mockReturnValue(result);

        const backend = new SpotdlBackend();
        const gen = backend.download([spotifyTrack()], { outputDir: OUT, preferredFormat: 'mp3' });
        await gen.next();
        await backend.cancel();
        expect(vi.mocked(killProcess)).toHaveBeenCalledTimes(1);
        release();
    });
});
