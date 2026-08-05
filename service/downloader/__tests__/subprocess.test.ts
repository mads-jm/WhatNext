import { describe, it, expect } from 'vitest';
import { spawn } from 'child_process';
import {
    parseYtdlpProgress,
    spawnLines,
    killProcess,
    runCommand,
    DownloadTimeoutError,
} from '../subprocess';

// These tests drive the REAL subprocess lifecycle using local `node` commands
// (no network, no external CLI) so the kill / timeout / line-buffering behaviour
// the epic must not regress is pinned deterministically.

describe('parseYtdlpProgress', () => {
    it('parses percent, speed and eta from a [download] line', () => {
        expect(
            parseYtdlpProgress(
                '[download]  42.3% of 5.20MiB at 1.23MiB/s ETA 00:03',
            ),
        ).toEqual({
            percent: 42.3,
            speed: '1.23MiB/s',
            eta: '00:03',
        });
    });

    it('returns null for lines without the [download] marker', () => {
        expect(
            parseYtdlpProgress('[info] Downloading 1 format(s): 251'),
        ).toBeNull();
        // Even a line with a percent is ignored unless it is a [download] line.
        expect(parseYtdlpProgress('Some text 50% done')).toBeNull();
    });

    it('returns null for a [download] line carrying no progress fields', () => {
        expect(
            parseYtdlpProgress('[download] Destination: /tmp/file.mp3'),
        ).toBeNull();
    });
});

describe('spawnLines', () => {
    it('yields stdout lines and resolves the exit code', async () => {
        const r = spawnLines('node', [
            '-e',
            "process.stdout.write('a\\nb\\n'); process.stdout.write('c\\nd\\n')",
        ]);
        const got: string[] = [];
        for await (const line of r.lines) got.push(line);
        expect(got).toEqual(['a', 'b', 'c', 'd']);
        expect(await r.exitCode).toBe(0);
    });

    it('flushes a trailing partial line on close', async () => {
        const r = spawnLines('node', ['-e', "process.stdout.write('x\\ny')"]);
        const got: string[] = [];
        for await (const line of r.lines) got.push(line);
        expect(got).toEqual(['x', 'y']);
    });

    it('throws DownloadTimeoutError when no output arrives within the window', async () => {
        const r = spawnLines('node', ['-e', 'setTimeout(() => {}, 10000)'], 50);
        await expect(
            (async () => {
                for await (const _line of r.lines) {
                    /* drain */
                }
            })(),
        ).rejects.toBeInstanceOf(DownloadTimeoutError);
    });
});

describe('killProcess', () => {
    it('is a no-op (no throw) for a process without a pid', () => {
        expect(() =>
            killProcess({ pid: undefined } as unknown as Parameters<
                typeof killProcess
            >[0]),
        ).not.toThrow();
    });

    it('terminates a running process', async () => {
        const proc = spawn('node', ['-e', 'setTimeout(() => {}, 10000)']);
        await new Promise((res) => proc.once('spawn', res));
        killProcess(proc);
        const code = await new Promise<number | null>((res) =>
            proc.on('close', (c) => res(c)),
        );
        // Killed processes exit with null code (signal) on POSIX or a non-zero code.
        expect(code !== 0).toBe(true);
    });
});

describe('runCommand', () => {
    it('collects stdout and the exit code', async () => {
        const r = await runCommand('node', [
            '-e',
            "process.stdout.write('hello')",
        ]);
        expect(r.code).toBe(0);
        expect(r.stdout).toBe('hello');
    });

    it('rejects when the command cannot be spawned', async () => {
        await expect(
            runCommand('definitely-not-a-real-binary-xyz', ['--version']),
        ).rejects.toThrow();
    });
});
