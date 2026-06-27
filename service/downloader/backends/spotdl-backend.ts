import type { DownloadBackend, BackendStatus, DownloadOptions } from '../backend';
import type { DownloadInput, ResolvedTrack, DownloadEvent } from '../types';
import { runCommand, spawnLines, killProcess, parseYtdlpProgress } from '../subprocess';
import type { ChildProcess } from 'child_process';

/**
 * spotDL backend.
 *
 * Primary use-case: given a Spotify track URL (built from a stored spotifyId),
 * spotDL finds matching audio on YouTube and downloads it with full Spotify
 * metadata (album art, lyrics, correct ID3 tags).
 *
 * Supports:
 *   - 'url'        — any Spotify URL (playlist, album, track)
 *   - 'spotify-id' — WhatNext-held spotifyId values; resolved to Spotify track URLs internally
 */
export class SpotdlBackend implements DownloadBackend {
    readonly id = 'spotdl';
    readonly name = 'spotDL';
    readonly supportedInputs = ['url', 'spotify-id'] as const;

    private activeProcess: ChildProcess | null = null;

    async checkInstalled(): Promise<BackendStatus> {
        try {
            const result = await runCommand('spotdl', ['--version']);
            if (result.code === 0) {
                return { installed: true, version: result.stdout.trim() };
            }
            return {
                installed: false,
                error: `spotdl exited with code ${result.code}: ${result.stderr.trim()}`,
            };
        } catch (err) {
            return {
                installed: false,
                error: err instanceof Error ? err.message : String(err),
            };
        }
    }

    async resolve(input: DownloadInput): Promise<ResolvedTrack[]> {
        const urls = this._inputToUrls(input);
        if (urls.length === 0) {
            throw new Error('SpotdlBackend: no resolvable URLs in input');
        }

        const tracks: ResolvedTrack[] = [];

        for (const url of urls) {
            // spotdl save --save-file - --output /dev/null prints JSON metadata to stdout
            const result = await runCommand('spotdl', ['save', url, '--save-file', '-']);
            if (result.code !== 0) {
                // Non-fatal per-track: skip and continue
                continue;
            }

            try {
                const parsed = JSON.parse(result.stdout) as Array<Record<string, unknown>>;
                for (const entry of parsed) {
                    tracks.push(this._mapEntry(entry, url));
                }
            } catch {
                // spotdl may not output parseable JSON for single tracks in all versions;
                // fall back to a minimal stub so the user can still select & download
                const spotifyId = this._extractSpotifyId(url);
                tracks.push({
                    sourceId: spotifyId ?? url,
                    sourceUrl: url,
                    sourceProvider: 'spotify',
                    title: url,
                    artists: [],
                    album: '',
                    durationMs: 0,
                    availableFormats: [],
                    spotifyId: spotifyId ?? undefined,
                });
            }
        }

        return tracks;
    }

    async *download(tracks: ResolvedTrack[], opts: DownloadOptions): AsyncGenerator<DownloadEvent> {
        const fmt = opts.preferredFormat === 'best_audio' ? 'mp3' : opts.preferredFormat;

        for (const track of tracks) {
            let completedPath: string | undefined;
            let lastStderr = '';
            let hadError = false;

            try {
                const args = [
                    'download',
                    track.sourceUrl,
                    '--output', opts.outputDir,
                    '--format', fmt,
                    '--print-errors',
                ];

                const result = spawnLines('spotdl', args, opts.timeoutMs);
                this.activeProcess = result.proc;

                for await (const line of result.lines) {
                    // spotdl uses similar [download] progress format as yt-dlp internally
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

                    // Detect saved file: "Downloaded "Artist - Title": /path/to/file.mp3"
                    const savedMatch = line.match(/Downloaded .+?: (.+)$/);
                    if (savedMatch) {
                        completedPath = savedMatch[1].trim();
                    }

                    // Detect "Skipping" (already downloaded)
                    if (line.includes('Skipping') && line.includes(opts.outputDir)) {
                        const skipMatch = line.match(/["'](.+?)["']/);
                        if (skipMatch) completedPath = skipMatch[1];
                    }
                }

                const exitCode = await result.exitCode;
                lastStderr = result.stderr();
                // Do NOT check stderr for "error" — spotDL writes benign warnings
                // containing "error" (e.g. "LookupError handled"). Rely on exit code.
                if (exitCode !== 0) hadError = true;

                this.activeProcess = null;

                if (hadError) {
                    yield {
                        type: 'error' as const,
                        sourceUrl: track.sourceUrl,
                        error: lastStderr.trim() || 'spotdl download failed',
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

    // -------------------------------------------------------------------------
    // Internal helpers
    // -------------------------------------------------------------------------

    /** Convert a DownloadInput to a list of Spotify URLs. */
    private _inputToUrls(input: DownloadInput): string[] {
        if (input.type === 'url' && input.url) {
            return [input.url];
        }
        if (input.type === 'spotify-ids' && input.spotifyIds) {
            return input.spotifyIds.map(
                (id) => `https://open.spotify.com/track/${id}`,
            );
        }
        return [];
    }

    /** Extract a Spotify track ID from a Spotify URL. */
    private _extractSpotifyId(url: string): string | null {
        const match = url.match(/spotify\.com\/track\/([A-Za-z0-9]+)/);
        return match ? match[1] : null;
    }

    /** Map a spotdl save-file entry to ResolvedTrack. */
    private _mapEntry(entry: Record<string, unknown>, fallbackUrl: string): ResolvedTrack {
        const url = (entry['url'] as string) || (entry['spotify_url'] as string) || fallbackUrl;
        const spotifyId = this._extractSpotifyId(url) ?? undefined;
        const artists = Array.isArray(entry['artists'])
            ? (entry['artists'] as string[])
            : entry['artist']
              ? [entry['artist'] as string]
              : [];

        return {
            sourceId: spotifyId ?? url,
            sourceUrl: url,
            sourceProvider: 'spotify',
            title: (entry['name'] as string) || (entry['title'] as string) || url,
            artists,
            album: (entry['album_name'] as string) || (entry['album'] as string) || '',
            durationMs: typeof entry['duration'] === 'number' ? (entry['duration'] as number) * 1000 : 0,
            thumbnailUrl: (entry['cover_url'] as string) || undefined,
            availableFormats: [],
            spotifyId,
        };
    }
}
