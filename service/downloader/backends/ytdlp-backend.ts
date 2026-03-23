import { ChildProcess } from 'child_process';
import type { DownloadBackend, BackendStatus, DownloadOptions } from '../backend';
import type { DownloadInput, ResolvedTrack, DownloadEvent } from '../types';
import { runCommand, spawnLines, killProcess, parseYtdlpProgress } from '../subprocess';
import { mapYtdlpEntries } from '../mapper';

export class YtdlpBackend implements DownloadBackend {
    readonly id = 'ytdlp';
    readonly name = 'yt-dlp';
    readonly supportedInputs = ['url'] as const;

    private activeProcess: ChildProcess | null = null;

    async checkInstalled(): Promise<BackendStatus> {
        try {
            const result = await runCommand('yt-dlp', ['--version']);
            if (result.code === 0) {
                return {
                    installed: true,
                    version: result.stdout.trim(),
                };
            }
            return {
                installed: false,
                error: `yt-dlp exited with code ${result.code}: ${result.stderr.trim()}`,
            };
        } catch (err) {
            return {
                installed: false,
                error: err instanceof Error ? err.message : String(err),
            };
        }
    }

    async resolve(input: DownloadInput): Promise<ResolvedTrack[]> {
        if (input.type !== 'url' || !input.url) {
            throw new Error('YtdlpBackend only supports url inputs');
        }

        const result = await runCommand('yt-dlp', [
            '--flat-playlist',
            '--dump-json',
            '--no-download',
            input.url,
        ]);

        if (result.code !== 0) {
            throw new Error(`yt-dlp resolve failed: ${result.stderr.trim()}`);
        }

        // yt-dlp outputs one JSON object per line for playlists
        const entries: Record<string, unknown>[] = result.stdout
            .split('\n')
            .filter((line) => line.trim().startsWith('{'))
            .map((line) => {
                try {
                    return JSON.parse(line) as Record<string, unknown>;
                } catch {
                    return null;
                }
            })
            .filter((entry): entry is Record<string, unknown> => entry !== null);

        return mapYtdlpEntries(entries);
    }

    async *download(tracks: ResolvedTrack[], opts: DownloadOptions): AsyncGenerator<DownloadEvent> {
        for (const track of tracks) {
            const outputTemplate = `${opts.outputDir}/%(uploader)s - %(title)s.%(ext)s`;

            // Collect output lines to detect the final destination path
            let completedPath: string | undefined;
            let lastStderr = '';
            let hadError = false;

            try {
                const args = [
                    '-x',
                    '--audio-format', opts.preferredFormat === 'best_audio' ? 'best' : opts.preferredFormat,
                    '--audio-quality', '0',
                    '--embed-thumbnail',
                    '--embed-metadata',
                    '--output', outputTemplate,
                    '--progress',
                    '--newline',
                    '--print', 'after_move:filepath',
                    track.sourceUrl,
                ];

                // We need the ChildProcess reference for cancel(), but spawnLines abstracts it.
                // Workaround: spawn manually and wire up the same logic.
                const { spawn } = await import('child_process');
                const proc = spawn('yt-dlp', args, { stdio: ['ignore', 'pipe', 'pipe'] });
                this.activeProcess = proc;

                // Collect stderr for error reporting; flag hard errors immediately
                proc.stderr?.on('data', (chunk: Buffer) => {
                    const text = chunk.toString('utf8');
                    lastStderr += text;
                    if (text.includes('ERROR:')) {
                        hadError = true;
                    }
                });

                let stdoutBuf = '';

                const linesGenerator = (async function* () {
                    for await (const chunk of proc.stdout) {
                        stdoutBuf += (chunk as Buffer).toString('utf8');
                        const parts = stdoutBuf.split('\n');
                        stdoutBuf = parts.pop() ?? '';
                        for (const line of parts) {
                            yield line;
                        }
                    }
                    // Flush remaining
                    if (stdoutBuf.length > 0) {
                        yield stdoutBuf;
                    }
                })();

                for await (const line of linesGenerator) {
                    // --print after_move:filepath outputs the final path as a bare line
                    // before the [download] lines, so we check for it first.
                    if (
                        line.trim().length > 0 &&
                        !line.startsWith('[') &&
                        !line.startsWith('ERROR') &&
                        !line.includes('%')
                    ) {
                        // Likely a file path from --print after_move:filepath
                        completedPath = line.trim();
                        continue;
                    }

                    const progress = parseYtdlpProgress(line);
                    if (progress) {
                        yield {
                            type: 'progress' as const,
                            sourceUrl: track.sourceUrl,
                            percent: progress.percent,
                            speed: progress.speed,
                            eta: progress.eta,
                        };
                    }

                    // Detect destination line: "[ExtractAudio] Destination: /path/to/file.mp3"
                    const destMatch = line.match(/Destination:\s+(.+)$/);
                    if (destMatch) {
                        completedPath = destMatch[1].trim();
                    }
                }

                // Wait for process to exit; non-zero code = error
                const exitCode = await new Promise<number | null>((resolve) => {
                    proc.on('close', resolve);
                });
                if (exitCode !== 0) {
                    hadError = true;
                }

                this.activeProcess = null;

                if (hadError) {
                    yield {
                        type: 'error' as const,
                        sourceUrl: track.sourceUrl,
                        error: lastStderr.trim() || 'Unknown yt-dlp error',
                    };
                } else {
                    yield {
                        type: 'complete' as const,
                        sourceUrl: track.sourceUrl,
                        localFilePath: completedPath,
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
