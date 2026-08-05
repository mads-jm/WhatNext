import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the subprocess seam but keep `parseYtdlpProgress` (and the timeout error)
// real so the actual progress-parsing logic is exercised.
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
import { YtdlpBackend } from '../backends/ytdlp-backend';
import type { DownloadEvent, ResolvedTrack } from '../types';
import { makeRunResult, makeSpawnLines, makeBlockingSpawnLines } from './helpers/fixture-process';
import { loadFixtureLines, loadFixtureText } from './helpers/load-fixture';

const OUT = '/home/u/WhatNext/audio';
const track: ResolvedTrack = {
    sourceId: 'dQw4w9WgXcQ',
    sourceUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    sourceProvider: 'youtube',
    title: '',
    artists: [],
    album: '',
    durationMs: 0,
    availableFormats: [],
};

async function collect(gen: AsyncGenerator<DownloadEvent>): Promise<DownloadEvent[]> {
    const out: DownloadEvent[] = [];
    for await (const e of gen) out.push(e);
    return out;
}

beforeEach(() => {
    vi.clearAllMocks();
});

describe('YtdlpBackend.download', () => {
    it('parses progress and captures the after_move:filepath as completedPath', async () => {
        vi.mocked(spawnLines).mockReturnValue(
            makeSpawnLines(loadFixtureLines('ytdlp-success.stdout.txt'), { exitCode: 0 }),
        );

        const events = await collect(
            new YtdlpBackend().download([track], { outputDir: OUT, preferredFormat: 'mp3' }),
        );

        const progress = events.filter((e) => e.type === 'progress');
        expect(progress.length).toBeGreaterThan(0);
        expect(progress.some((e) => e.percent === 42.3 && e.speed === '1.23MiB/s' && e.eta === '00:03')).toBe(true);

        const complete = events.at(-1)!;
        expect(complete.type).toBe('complete');
        // The after_move path is printed behind the WHATNEXT_FILEPATH= sentinel;
        // it — not the bare "Deleting original file ...webm" info line — is captured.
        expect(complete.localFilePath).toBe(`${OUT}/Rick Astley - Never Gonna Give You Up.mp3`);
    });

    it('does not mis-capture an informational stdout line as completedPath (no Destination present)', async () => {
        // Isolates the completed-path heuristic regression (#45): with no
        // [ExtractAudio] Destination fallback, only the WHATNEXT_FILEPATH= sentinel
        // line may be taken as the path. The bare "Deleting original file ..." info
        // line — and the sentinel prefix itself — must never leak into completedPath.
        vi.mocked(spawnLines).mockReturnValue(
            makeSpawnLines(
                [
                    '[download] 100% of 2.00MiB in 00:01',
                    'Deleting original file /home/u/WhatNext/audio/x.webm (pass -k to keep)',
                    'WHATNEXT_FILEPATH=/home/u/WhatNext/audio/x.mp3',
                ],
                { exitCode: 0 },
            ),
        );

        const events = await collect(
            new YtdlpBackend().download([track], { outputDir: OUT, preferredFormat: 'mp3' }),
        );

        const complete = events.at(-1)!;
        expect(complete.type).toBe('complete');
        expect(complete.localFilePath).toBe('/home/u/WhatNext/audio/x.mp3');
    });

    it('falls back to the [ExtractAudio] Destination path when no after_move line is printed', async () => {
        vi.mocked(spawnLines).mockReturnValue(
            makeSpawnLines(loadFixtureLines('ytdlp-destination-fallback.stdout.txt'), { exitCode: 0 }),
        );

        const events = await collect(
            new YtdlpBackend().download([track], { outputDir: OUT, preferredFormat: 'mp3' }),
        );

        const complete = events.at(-1)!;
        expect(complete.type).toBe('complete');
        expect(complete.localFilePath).toBe(`${OUT}/Some Artist - A Song.mp3`);
    });

    it('emits an error event when stderr contains ERROR: (non-zero exit)', async () => {
        vi.mocked(spawnLines).mockReturnValue(
            makeSpawnLines([], { stderr: loadFixtureText('ytdlp-error.stderr.txt'), exitCode: 1 }),
        );

        const events = await collect(
            new YtdlpBackend().download([track], { outputDir: OUT, preferredFormat: 'mp3' }),
        );

        expect(events).toHaveLength(1);
        expect(events[0].type).toBe('error');
        expect(events[0].error).toContain('Private video');
    });

    it('treats ERROR: in stderr as failure even when exit code is 0', async () => {
        vi.mocked(spawnLines).mockReturnValue(
            makeSpawnLines([], { stderr: loadFixtureText('ytdlp-error.stderr.txt'), exitCode: 0 }),
        );

        const events = await collect(
            new YtdlpBackend().download([track], { outputDir: OUT, preferredFormat: 'mp3' }),
        );

        expect(events[0].type).toBe('error');
    });
});

describe('YtdlpBackend argv hygiene', () => {
    // Second layer behind the IPC guard: yt-dlp reads a leading-dash positional as an
    // option (`--exec=…` is command execution), and everything after `--` is a
    // positional. Verified against the real yt-dlp 2026.07.04 CLI — the subprocess
    // seam is mocked here, so this test can only prove the ordering, not acceptance.
    it('places -- immediately before the URL when resolving', async () => {
        vi.mocked(runCommand).mockResolvedValue(makeRunResult({ code: 0, stdout: '' }));

        await new YtdlpBackend().resolve({ type: 'url', url: 'https://youtu.be/abc' });

        const args = vi.mocked(runCommand).mock.calls[0][1];
        expect(args).toEqual([
            '--flat-playlist',
            '--dump-json',
            '--no-download',
            '--',
            'https://youtu.be/abc',
        ]);
    });

    it('places -- immediately before the URL when downloading', async () => {
        vi.mocked(spawnLines).mockReturnValue(makeSpawnLines([], { exitCode: 0 }));

        await collect(
            new YtdlpBackend().download([track], { outputDir: OUT, preferredFormat: 'mp3' }),
        );

        const args = vi.mocked(spawnLines).mock.calls[0][1];
        expect(args.at(-1)).toBe(track.sourceUrl);
        expect(args.at(-2)).toBe('--');
        // No option may follow the separator, or yt-dlp would take it as a URL.
        expect(args.indexOf('--')).toBe(args.length - 2);
    });
});

describe('YtdlpBackend.checkInstalled', () => {
    it('reports installed with the trimmed version on clean exit', async () => {
        vi.mocked(runCommand).mockResolvedValue(makeRunResult({ code: 0, stdout: '2024.08.06\n' }));
        const status = await new YtdlpBackend().checkInstalled();
        expect(status).toMatchObject({ installed: true, version: '2024.08.06' });
    });

    it('reports not installed when spawn errors (binary absent)', async () => {
        vi.mocked(runCommand).mockRejectedValue(new Error('spawn yt-dlp ENOENT'));
        const status = await new YtdlpBackend().checkInstalled();
        expect(status.installed).toBe(false);
        expect(status.error).toContain('ENOENT');
    });

    it('reports not installed on a non-zero exit', async () => {
        vi.mocked(runCommand).mockResolvedValue(makeRunResult({ code: 2, stderr: 'boom' }));
        const status = await new YtdlpBackend().checkInstalled();
        expect(status.installed).toBe(false);
        expect(status.error).toContain('code 2');
    });

    it('surfaces a configured custom path in the status', async () => {
        vi.mocked(runCommand).mockResolvedValue(makeRunResult({ code: 0, stdout: '2024.08.06' }));
        const status = await new YtdlpBackend('/opt/bin/yt-dlp').checkInstalled();
        expect(status.path).toBe('/opt/bin/yt-dlp');
        // The custom path is the executable actually invoked.
        expect(vi.mocked(runCommand).mock.calls[0][0]).toBe('/opt/bin/yt-dlp');
    });

    it('invokes the bare command (no path) by default', async () => {
        vi.mocked(runCommand).mockResolvedValue(makeRunResult({ code: 0, stdout: '2024.08.06' }));
        const status = await new YtdlpBackend().checkInstalled();
        expect(status.path).toBeUndefined();
        expect(vi.mocked(runCommand).mock.calls[0][0]).toBe('yt-dlp');
    });
});

describe('YtdlpBackend.cancel', () => {
    it('kills the active process and stops the in-flight download', async () => {
        const { result, release } = makeBlockingSpawnLines([
            '[download]  10.0% of 5.00MiB at 1.00MiB/s ETA 00:05',
        ]);
        vi.mocked(spawnLines).mockReturnValue(result);

        const backend = new YtdlpBackend();
        const gen = backend.download([track], { outputDir: OUT, preferredFormat: 'mp3' });

        const first = await gen.next();
        expect(first.value).toMatchObject({ type: 'progress', percent: 10 });

        await backend.cancel();
        expect(vi.mocked(killProcess)).toHaveBeenCalledTimes(1);
        expect(vi.mocked(killProcess).mock.calls[0][0]).toBe(result.proc);

        release();
    });
});
