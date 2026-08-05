import type { DownloadBackend, BackendStatus, DownloadOptions } from '../backend';
import type { DownloadInput, ResolvedTrack, DownloadEvent } from '../types';
import { runCommand, spawnLines, killProcess, parseYtdlpProgress } from '../subprocess';
import type { ChildProcess } from 'child_process';
import { mapYtdlpEntries } from '../mapper';

/** Bare command name resolved via PATH when no custom path is configured. */
const DEFAULT_EXE = 'yt-dlp';

/**
 * Sentinel prefix for the final moved file path. We ask yt-dlp to print the
 * post-move filepath behind this marker (`--print after_move:<MARKER>%(filepath)s`)
 * so the capture is unambiguous: only lines starting with the marker are treated
 * as the completed path. The previous heuristic captured *any* bare line without
 * `[`/`ERROR`/`%`, which could mis-capture informational lines like
 * "Deleting original file …".
 */
const FILEPATH_MARKER = 'WHATNEXT_FILEPATH=';

export class YtdlpBackend implements DownloadBackend {
    readonly id = 'ytdlp';
    readonly name = 'yt-dlp';
    readonly supportedInputs = ['url'] as const;

    private activeProcess: ChildProcess | null = null;

    /** Executable actually invoked: a user-configured path, or the bare command. */
    private readonly exe: string;
    /** The configured custom path (undefined when relying on PATH lookup). */
    private readonly customPath?: string;

    /**
     * @param executablePath Optional absolute/relative path to the yt-dlp binary.
     *   When omitted (or blank), the bare command `yt-dlp` is resolved via PATH —
     *   preserving the original behaviour.
     */
    constructor(executablePath?: string) {
        const trimmed = executablePath?.trim();
        this.exe = trimmed || DEFAULT_EXE;
        this.customPath = trimmed || undefined;
    }

    async checkInstalled(): Promise<BackendStatus> {
        try {
            const result = await runCommand(this.exe, ['--version']);
            if (result.code === 0) {
                return {
                    installed: true,
                    version: result.stdout.trim(),
                    path: this.customPath,
                };
            }
            return {
                installed: false,
                path: this.customPath,
                error: `yt-dlp exited with code ${result.code}: ${result.stderr.trim()}`,
            };
        } catch (err) {
            return {
                installed: false,
                path: this.customPath,
                error: err instanceof Error ? err.message : String(err),
            };
        }
    }

    async resolve(input: DownloadInput): Promise<ResolvedTrack[]> {
        if (input.type !== 'url' || !input.url) {
            throw new Error('YtdlpBackend only supports url inputs');
        }

        const result = await runCommand(this.exe, [
            '--flat-playlist',
            '--dump-json',
            '--no-download',
            // Everything after `--` is a positional, so a URL that somehow got past the
            // IPC guard cannot be read as an option (`--exec=…` would be command
            // execution). Second layer only — validation at the boundary is the first.
            '--',
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
                    '--print', `after_move:${FILEPATH_MARKER}%(filepath)s`,
                    // See resolve(): `--` forces the URL to be read as a positional.
                    '--',
                    track.sourceUrl,
                ];

                const result = spawnLines(this.exe, args, opts.timeoutMs);
                this.activeProcess = result.proc;

                for await (const line of result.lines) {
                    // The post-move filepath is printed behind a sentinel marker
                    // (see FILEPATH_MARKER) so only this line — never a stray
                    // informational line — is taken as the completed path.
                    if (line.startsWith(FILEPATH_MARKER)) {
                        completedPath = line.slice(FILEPATH_MARKER.length).trim();
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

                const exitCode = await result.exitCode;
                lastStderr = result.stderr();
                if (exitCode !== 0 || lastStderr.includes('ERROR:')) {
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
