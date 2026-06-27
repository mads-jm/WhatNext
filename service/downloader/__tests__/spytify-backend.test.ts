import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Spytify reads checkInstalled via runCommand and spawns the recorder via a
// dynamic `import('child_process')`. We mock both seams.
vi.mock('../subprocess', async (orig) => {
    const actual = await orig<typeof import('../subprocess')>();
    return { ...actual, runCommand: vi.fn(), killProcess: vi.fn() };
});
vi.mock('child_process', () => ({ spawn: vi.fn() }));

import { spawn } from 'child_process';
import { runCommand } from '../subprocess';
import { SpytifyBackend } from '../backends/spytify-backend';
import type { DownloadEvent, ResolvedTrack } from '../types';
import { makeRunResult, makeFakeChild } from './helpers/fixture-process';
import { loadFixtureLines } from './helpers/load-fixture';

const OUT = 'C:\\Users\\u\\WhatNext\\audio';

function track(): ResolvedTrack {
    return {
        sourceId: 'live',
        sourceUrl: 'spotify:playback:current',
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

const realPlatform = process.platform;
function setPlatform(value: NodeJS.Platform): void {
    Object.defineProperty(process, 'platform', { value, configurable: true });
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => setPlatform(realPlatform));

describe('SpytifyBackend on non-Windows', () => {
    it('checkInstalled reports not installed without spawning', async () => {
        setPlatform('linux');
        const status = await new SpytifyBackend().checkInstalled();
        expect(status.installed).toBe(false);
        expect(status.error).toMatch(/Windows/);
        expect(vi.mocked(runCommand)).not.toHaveBeenCalled();
    });

    it('download yields an error event and never spawns', async () => {
        setPlatform('linux');
        const events = await collect(
            new SpytifyBackend().download([track()], { outputDir: OUT, preferredFormat: 'mp3' }),
        );
        expect(events).toEqual([
            { type: 'error', sourceUrl: 'spotify:playback:current', error: 'Spytify is Windows-only' },
        ]);
        expect(vi.mocked(spawn)).not.toHaveBeenCalled();
    });
});

describe('SpytifyBackend on Windows (platform stubbed)', () => {
    it('captures "Saving to:" and "Recording... XX%" progress', async () => {
        setPlatform('win32');
        vi.mocked(spawn).mockReturnValue(
            makeFakeChild(loadFixtureLines('spytify-success.stdout.txt'), { exitCode: 0 }) as ReturnType<typeof spawn>,
        );

        const events = await collect(
            new SpytifyBackend().download([track()], { outputDir: OUT, preferredFormat: 'mp3' }),
        );

        const percents = events.filter((e) => e.type === 'progress').map((e) => e.percent);
        expect(percents).toEqual([0, 50, 100]);

        const complete = events.at(-1)!;
        expect(complete.type).toBe('complete');
        expect(complete.localFilePath).toBe('C:\\Users\\u\\WhatNext\\audio\\Daft Punk - Around the World.mp3');
        expect(complete.audioFormat).toBe('mp3');
    });

    it('emits an error event when the recorder exits non-zero', async () => {
        setPlatform('win32');
        vi.mocked(spawn).mockReturnValue(
            makeFakeChild([], { stderr: 'Spotify not running', exitCode: 1 }) as ReturnType<typeof spawn>,
        );

        const events = await collect(
            new SpytifyBackend().download([track()], { outputDir: OUT, preferredFormat: 'mp3' }),
        );
        expect(events).toHaveLength(1);
        expect(events[0].type).toBe('error');
        expect(events[0].error).toContain('Spotify not running');
    });

    it('checkInstalled probes the binary and parses the version', async () => {
        setPlatform('win32');
        vi.mocked(runCommand).mockResolvedValue(makeRunResult({ code: 0, stdout: '1.10.0' }));
        const status = await new SpytifyBackend().checkInstalled();
        expect(status).toMatchObject({ installed: true, version: '1.10.0' });
    });

    it('uses a configured custom path for the recorder', async () => {
        setPlatform('win32');
        vi.mocked(spawn).mockReturnValue(
            makeFakeChild(loadFixtureLines('spytify-success.stdout.txt'), { exitCode: 0 }) as ReturnType<typeof spawn>,
        );
        await collect(
            new SpytifyBackend('C:\\tools\\spytify.exe').download([track()], {
                outputDir: OUT,
                preferredFormat: 'mp3',
            }),
        );
        expect(vi.mocked(spawn).mock.calls[0][0]).toBe('C:\\tools\\spytify.exe');
    });
});
