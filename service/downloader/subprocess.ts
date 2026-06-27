import { spawn, execSync, ChildProcess } from 'child_process';

export interface SpawnResult {
    code: number | null;
    stdout: string;
    stderr: string;
}

// ---------------------------------------------------------------------------
// Active process registry
// ---------------------------------------------------------------------------
// All spawned child processes are registered here so they can be killed when
// the app exits. Processes are automatically removed when they close naturally.

const _activeProcesses = new Set<ChildProcess>();

function trackProcess(proc: ChildProcess): void {
    _activeProcesses.add(proc);
    proc.on('close', () => {
        _activeProcesses.delete(proc);
    });
}

/**
 * Kill all tracked child processes.
 * Call this on app quit to prevent orphaned yt-dlp / spotdl processes.
 */
export function killAll(): void {
    for (const proc of _activeProcesses) {
        killProcess(proc);
    }
    _activeProcesses.clear();
}

/**
 * Run a command to completion, collecting stdout and stderr.
 * Uses spawn (not exec) to avoid shell injection.
 */
export async function runCommand(cmd: string, args: string[]): Promise<SpawnResult> {
    return new Promise((resolve, reject) => {
        const proc = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
        trackProcess(proc);

        let stdout = '';
        let stderr = '';

        proc.stdout.on('data', (chunk: Buffer) => {
            stdout += chunk.toString('utf8');
        });

        proc.stderr.on('data', (chunk: Buffer) => {
            stderr += chunk.toString('utf8');
        });

        proc.on('error', (err) => {
            reject(err);
        });

        proc.on('close', (code) => {
            resolve({ code, stdout, stderr });
        });
    });
}

export interface SpawnLinesResult {
    /** Async generator that yields stdout lines as they arrive. */
    lines: AsyncGenerator<string>;
    /** The underlying ChildProcess — use for cancel(). */
    proc: ChildProcess;
    /** Returns all stderr collected so far. */
    stderr: () => string;
    /** Resolves with the exit code when the process closes. */
    exitCode: Promise<number | null>;
}

/**
 * Thrown (via the async generator) when the inactivity timeout fires.
 * Backends catch this and yield a typed error event.
 */
export class DownloadTimeoutError extends Error {
    constructor(timeoutMs: number) {
        super(`Download stalled: no output for ${timeoutMs / 1000}s`);
        this.name = 'DownloadTimeoutError';
    }
}

/** Default inactivity timeout: 5 minutes. */
const DEFAULT_TIMEOUT_MS = 300_000;

/**
 * Spawn a long-running process and yield stdout lines as they arrive.
 * Buffers partial lines across chunk boundaries.
 *
 * The `timeout` parameter (default 300 000 ms) is an *inactivity* timeout —
 * it resets on every stdout/stderr chunk. If no output arrives within the
 * window, the child process is killed and the generator throws
 * `DownloadTimeoutError`.
 *
 * Returns the async line generator alongside the ChildProcess and stderr
 * accessor so callers can cancel and read error output.
 */
export function spawnLines(cmd: string, args: string[], timeout = DEFAULT_TIMEOUT_MS): SpawnLinesResult {
    const proc = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    trackProcess(proc);

    // Collect stderr separately (don't yield it)
    let stderrBuf = '';
    proc.stderr?.on('data', (chunk: Buffer) => {
        stderrBuf += chunk.toString('utf8');
        resetTimer();
    });

    // ---------------------------------------------------------------------------
    // Inactivity timer — reset on every stdout/stderr chunk
    // ---------------------------------------------------------------------------
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

    const fireTimeout = () => {
        procError = new DownloadTimeoutError(timeout);
        done = true;
        killProcess(proc);
        if (resolveNext) {
            const res = resolveNext;
            resolveNext = null;
            res({ value: undefined as unknown as string, done: true });
        }
    };

    const resetTimer = () => {
        if (timeout <= 0) return;
        if (timeoutHandle !== null) clearTimeout(timeoutHandle);
        timeoutHandle = setTimeout(fireTimeout, timeout);
    };

    // Start the timer immediately; it will be reset as output arrives.
    resetTimer();

    // ---------------------------------------------------------------------------
    // Yield stdout lines from a readline-style buffer
    // ---------------------------------------------------------------------------
    let buf = '';
    const pendingLines: string[] = [];
    let resolveNext: ((val: IteratorResult<string>) => void) | null = null;
    let done = false;
    let procError: Error | null = null;

    const pushLine = (line: string) => {
        if (resolveNext) {
            const res = resolveNext;
            resolveNext = null;
            res({ value: line, done: false });
        } else {
            pendingLines.push(line);
        }
    };

    proc.stdout.on('data', (chunk: Buffer) => {
        resetTimer();
        buf += chunk.toString('utf8');
        const parts = buf.split('\n');
        buf = parts.pop() ?? '';
        for (const line of parts) {
            pushLine(line);
        }
    });

    proc.on('error', (err) => {
        if (timeoutHandle !== null) clearTimeout(timeoutHandle);
        procError = err;
        done = true;
        if (resolveNext) {
            const res = resolveNext;
            resolveNext = null;
            res({ value: undefined as unknown as string, done: true });
        }
    });

    proc.on('close', () => {
        if (timeoutHandle !== null) clearTimeout(timeoutHandle);
        // Flush any remaining partial line
        if (buf.length > 0) {
            pushLine(buf);
            buf = '';
        }
        done = true;
        if (resolveNext) {
            const res = resolveNext;
            resolveNext = null;
            res({ value: undefined as unknown as string, done: true });
        }
    });

    const exitCode = new Promise<number | null>((resolve) => {
        proc.on('close', resolve);
    });

    async function* generate(): AsyncGenerator<string> {
        while (true) {
            if (pendingLines.length > 0) {
                yield pendingLines.shift()!;
            } else if (done) {
                if (procError) throw procError;
                return;
            } else {
                const result = await new Promise<IteratorResult<string>>((res) => {
                    if (pendingLines.length > 0) {
                        res({ value: pendingLines.shift()!, done: false });
                    } else if (done) {
                        res({ value: undefined as unknown as string, done: true });
                    } else {
                        resolveNext = res;
                    }
                });
                if (result.done) {
                    if (procError) throw procError;
                    return;
                }
                yield result.value;
            }
        }
    }

    return {
        lines: generate(),
        proc,
        stderr: () => stderrBuf,
        exitCode,
    };
}

/**
 * Kill a running process.
 * On Windows, uses `taskkill /T /F` to kill the entire process tree (yt-dlp
 * spawns ffmpeg/aria2c children that survive a bare SIGTERM/SIGKILL).
 * On POSIX, sends SIGTERM and falls back to SIGKILL after 2 seconds.
 */
export function killProcess(proc: ChildProcess): void {
    if (!proc.pid) return;
    try {
        if (process.platform === 'win32') {
            execSync(`taskkill /T /F /PID ${proc.pid}`, { stdio: 'ignore' });
        } else {
            proc.kill('SIGTERM');
            setTimeout(() => {
                try {
                    proc.kill('SIGKILL');
                } catch {
                    // Already dead
                }
            }, 2000);
        }
    } catch {
        // Process may already be dead
    }
}

/**
 * Parse yt-dlp progress lines such as:
 *   [download]  42.3% of 5.20MiB at 1.23MiB/s ETA 00:03
 */
export function parseYtdlpProgress(
    line: string,
): { percent?: number; speed?: string; eta?: string } | null {
    if (!line.includes('[download]')) return null;

    const result: { percent?: number; speed?: string; eta?: string } = {};

    const percentMatch = line.match(/(\d+(?:\.\d+)?)%/);
    if (percentMatch) {
        result.percent = parseFloat(percentMatch[1]);
    }

    const speedMatch = line.match(/at\s+(\S+\/s)/);
    if (speedMatch) {
        result.speed = speedMatch[1];
    }

    const etaMatch = line.match(/ETA\s+(\S+)/);
    if (etaMatch) {
        result.eta = etaMatch[1];
    }

    if (result.percent === undefined && result.speed === undefined && result.eta === undefined) {
        return null;
    }

    return result;
}
