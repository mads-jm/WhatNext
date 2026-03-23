import { spawn, ChildProcess } from 'child_process';

export interface SpawnResult {
    code: number | null;
    stdout: string;
    stderr: string;
}

/**
 * Run a command to completion, collecting stdout and stderr.
 * Uses spawn (not exec) to avoid shell injection.
 */
export async function runCommand(cmd: string, args: string[]): Promise<SpawnResult> {
    return new Promise((resolve, reject) => {
        const proc = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });

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

/**
 * Spawn a long-running process and yield stdout lines as they arrive.
 * Buffers partial lines across chunk boundaries.
 */
export async function* spawnLines(cmd: string, args: string[]): AsyncGenerator<string> {
    const proc = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });

    // Collect stderr separately (don't yield it — callers can check proc.stderr if needed)
    let stderrBuf = '';
    proc.stderr?.on('data', (chunk: Buffer) => {
        stderrBuf += chunk.toString('utf8');
    });

    // Yield stdout lines from a readline-style buffer
    let buf = '';
    const lines: string[] = [];
    let resolveNext: ((val: IteratorResult<string>) => void) | null = null;
    let done = false;
    let procError: Error | null = null;

    const pushLine = (line: string) => {
        if (resolveNext) {
            const res = resolveNext;
            resolveNext = null;
            res({ value: line, done: false });
        } else {
            lines.push(line);
        }
    };

    proc.stdout.on('data', (chunk: Buffer) => {
        buf += chunk.toString('utf8');
        const parts = buf.split('\n');
        buf = parts.pop() ?? '';
        for (const line of parts) {
            pushLine(line);
        }
    });

    proc.on('error', (err) => {
        procError = err;
        done = true;
        if (resolveNext) {
            const res = resolveNext;
            resolveNext = null;
            res({ value: undefined as unknown as string, done: true });
        }
    });

    proc.on('close', () => {
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

    while (true) {
        if (lines.length > 0) {
            yield lines.shift()!;
        } else if (done) {
            if (procError) throw procError;
            return;
        } else {
            // Wait for the next line or close event
            const result = await new Promise<IteratorResult<string>>((res) => {
                if (lines.length > 0) {
                    res({ value: lines.shift()!, done: false });
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

/**
 * Kill a running process (SIGTERM first, then SIGKILL after a short delay).
 */
export function killProcess(proc: ChildProcess): void {
    try {
        proc.kill('SIGTERM');
        setTimeout(() => {
            try {
                proc.kill('SIGKILL');
            } catch {
                // Already dead
            }
        }, 2000);
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
