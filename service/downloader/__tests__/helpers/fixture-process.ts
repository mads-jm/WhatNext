/**
 * Test seam for backend-execution tests (#45).
 *
 * The three download backends touch the outside world exclusively through
 * `runCommand` / `spawnLines` (in `../../subprocess`) and, for Spytify, a direct
 * `child_process.spawn`. These helpers manufacture the *shape* those functions
 * return so a backend can be driven against recorded CLI output with **no real
 * binary present**.
 *
 * Usage pattern (per backend test file):
 *
 *   vi.mock('../../subprocess', async (orig) => {
 *       const actual = await orig<typeof import('../../subprocess')>();
 *       return { ...actual, runCommand: vi.fn(), spawnLines: vi.fn(), killProcess: vi.fn() };
 *   });
 *
 * Then in a test:
 *
 *   vi.mocked(spawnLines).mockReturnValue(makeSpawnLines(fixtureLines, { exitCode: 0 }));
 *
 * `parseYtdlpProgress` and `DownloadTimeoutError` are intentionally left real
 * (spread from the actual module) so the parsing logic under test is exercised.
 */

import type { ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { Readable } from 'stream';
import type { SpawnResult, SpawnLinesResult } from '../../subprocess';

/** Build a `runCommand` result (used for `checkInstalled` / `resolve`). */
export function makeRunResult(p: {
    code: number | null;
    stdout?: string;
    stderr?: string;
}): SpawnResult {
    return { code: p.code, stdout: p.stdout ?? '', stderr: p.stderr ?? '' };
}

/**
 * Build a `spawnLines` result from a fixed list of stdout lines. The line
 * generator completes synchronously after yielding every line, mirroring a
 * process that exits cleanly.
 */
export function makeSpawnLines(
    lines: string[],
    opts: { stderr?: string; exitCode?: number | null } = {},
): SpawnLinesResult {
    async function* gen(): AsyncGenerator<string> {
        for (const line of lines) yield line;
    }
    return {
        lines: gen(),
        proc: { pid: 4242 } as ChildProcess,
        stderr: () => opts.stderr ?? '',
        exitCode: Promise.resolve(opts.exitCode ?? 0),
    };
}

/**
 * Build a `spawnLines` result whose generator yields `lines`, then blocks
 * forever — simulating a download that is still in-flight. Used to test
 * `cancel()` mid-stream. The returned `release` resolves the block so the
 * test runner can tear down cleanly.
 */
export function makeBlockingSpawnLines(lines: string[]): {
    result: SpawnLinesResult;
    release: () => void;
} {
    let release!: () => void;
    const blocked = new Promise<void>((r) => {
        release = r;
    });
    async function* gen(): AsyncGenerator<string> {
        for (const line of lines) yield line;
        await blocked;
    }
    return {
        result: {
            lines: gen(),
            proc: { pid: 4242 } as ChildProcess,
            stderr: () => '',
            exitCode: new Promise<number | null>(() => {
                /* never resolves while in-flight */
            }),
        },
        release,
    };
}

/**
 * Build a fake `ChildProcess` for Spytify's inline `child_process.spawn`.
 * `stdout` is an async-iterable Readable that ends after the fixture lines;
 * once it drains, optional stderr is emitted and `close` fires with `exitCode`.
 */
export function makeFakeChild(
    stdoutLines: string[],
    opts: { stderr?: string; exitCode?: number | null } = {},
): ChildProcess {
    const proc = new EventEmitter() as EventEmitter & ChildProcess;
    (proc as unknown as { pid: number }).pid = 4242;
    (proc as unknown as { kill: () => boolean }).kill = () => true;

    const stdout = Readable.from(
        (async function* () {
            for (const line of stdoutLines) yield Buffer.from(line + '\n');
        })(),
    );
    const stderr = new EventEmitter();
    (proc as unknown as { stdout: unknown }).stdout = stdout;
    (proc as unknown as { stderr: unknown }).stderr = stderr;

    stdout.on('end', () => {
        if (opts.stderr) stderr.emit('data', Buffer.from(opts.stderr));
        // Defer close to a macrotask so the backend's `on('close')` listener,
        // attached synchronously after the for-await loop, is registered first.
        setImmediate(() => proc.emit('close', opts.exitCode ?? 0));
    });

    return proc;
}
