import { ChildProcess } from 'child_process';
import type { DownloadBackend, BackendStatus, DownloadOptions } from '../backend';
import type { DownloadInput, ResolvedTrack, DownloadEvent } from '../types';
import { runCommand, killProcess } from '../subprocess';

/** Bare command name resolved via PATH when no custom path is configured. */
const DEFAULT_EXE = 'spytify';

/**
 * Spytify backend — Windows-only.
 *
 * Spytify records Spotify's audio output in real-time rather than downloading
 * a separate audio source. This guarantees exact Spotify audio quality
 * (Free: 160 kbps, Premium: 320 kbps) with no YouTube matching errors.
 *
 * Limitations:
 *   - Windows only (.NET, requires Spotify desktop app)
 *   - Real-time (1× playback speed — not suitable for bulk downloads)
 *   - No URL resolution (input is a playing Spotify context, not a static URL)
 *
 * CLI: `spytify --path <dir> --format <mp3|wav> [--bitrate <kbps>]`
 */
export class SpytifyBackend implements DownloadBackend {
    readonly id = 'spytify';
    readonly name = 'Spytify';
    readonly supportedInputs = ['spotify-playback'] as const;

    private activeProcess: ChildProcess | null = null;

    /** Executable actually invoked: a user-configured path, or the bare command. */
    private readonly exe: string;
    /** The configured custom path (undefined when relying on PATH lookup). */
    private readonly customPath?: string;

    /**
     * @param executablePath Optional path to the Spytify binary. When omitted
     *   (or blank), the bare command `spytify` is resolved via PATH.
     */
    constructor(executablePath?: string) {
        const trimmed = executablePath?.trim();
        this.exe = trimmed || DEFAULT_EXE;
        this.customPath = trimmed || undefined;
    }

    async checkInstalled(): Promise<BackendStatus> {
        if (process.platform !== 'win32') {
            return {
                installed: false,
                path: this.customPath,
                error: 'Spytify requires Windows and the Spotify desktop app',
            };
        }
        try {
            const result = await runCommand(this.exe, ['--version']);
            if (result.code === 0) {
                return { installed: true, version: result.stdout.trim(), path: this.customPath };
            }
            return {
                installed: false,
                path: this.customPath,
                error: `spytify exited with code ${result.code}: ${result.stderr.trim()}`,
            };
        } catch (err) {
            return {
                installed: false,
                path: this.customPath,
                error: err instanceof Error ? err.message : String(err),
            };
        }
    }

    async resolve(_input: DownloadInput): Promise<ResolvedTrack[]> {
        throw new Error(
            'Spytify records live Spotify playback; URL resolution is not supported. ' +
            'Use yt-dlp or spotDL for URL-based downloads.',
        );
    }

    async *download(tracks: ResolvedTrack[], opts: DownloadOptions): AsyncGenerator<DownloadEvent> {
        if (process.platform !== 'win32') {
            for (const track of tracks) {
                yield {
                    type: 'error',
                    sourceUrl: track.sourceUrl,
                    error: 'Spytify is Windows-only',
                };
            }
            return;
        }

        const fmt = opts.preferredFormat === 'best_audio' ? 'mp3' : opts.preferredFormat;

        for (const track of tracks) {
            try {
                const args = [
                    '--path', opts.outputDir,
                    '--format', fmt,
                    // Spytify records whatever Spotify is currently playing;
                    // the sourceUrl is informational for progress tracking only.
                ];

                const { spawn } = await import('child_process');
                const proc = spawn(this.exe, args, { stdio: ['ignore', 'pipe', 'pipe'] });
                this.activeProcess = proc;

                let lastStderr = '';
                let completedPath: string | undefined;

                proc.stderr?.on('data', (chunk: Buffer) => {
                    lastStderr += chunk.toString('utf8');
                });

                let stdoutBuf = '';
                const linesGen = (async function* () {
                    for await (const chunk of proc.stdout) {
                        stdoutBuf += (chunk as Buffer).toString('utf8');
                        const parts = stdoutBuf.split('\n');
                        stdoutBuf = parts.pop() ?? '';
                        for (const line of parts) yield line;
                    }
                    if (stdoutBuf.length > 0) yield stdoutBuf;
                })();

                for await (const line of linesGen) {
                    // Spytify outputs: "Saving to: /path/to/file.mp3"
                    const savedMatch = line.match(/Saving to:\s*(.+)$/i);
                    if (savedMatch) {
                        completedPath = savedMatch[1].trim();
                    }

                    // Rough progress heuristic from "Recording... XX%"
                    const progressMatch = line.match(/Recording\.\.\.\s*(\d+)%/i);
                    if (progressMatch) {
                        yield {
                            type: 'progress' as const,
                            sourceUrl: track.sourceUrl,
                            percent: parseInt(progressMatch[1], 10),
                        };
                    }
                }

                const exitCode = await new Promise<number | null>((resolve) =>
                    proc.on('close', resolve),
                );
                this.activeProcess = null;

                if (exitCode !== 0) {
                    yield {
                        type: 'error' as const,
                        sourceUrl: track.sourceUrl,
                        error: lastStderr.trim() || 'spytify recording failed',
                    };
                } else {
                    yield {
                        type: 'complete' as const,
                        sourceUrl: track.sourceUrl,
                        localFilePath: completedPath,
                        audioFormat: fmt,
                    };
                }
            } catch (err) {
                this.activeProcess = null;
                yield {
                    type: 'error' as const,
                    sourceUrl: track.sourceUrl,
                    error: err instanceof Error ? err.message : String(err),
                };
            }
        }
    }

    async cancel(): Promise<void> {
        if (this.activeProcess) {
            killProcess(this.activeProcess);
            this.activeProcess = null;
        }
    }
}
