import { ipcMain, BrowserWindow, dialog } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { IPC_CHANNELS } from '../../shared/core/ipc-protocol';
import type {
    BackendStatusResult,
    DownloadResolveRequest,
    BackendPathMap,
    SetBackendPathResult,
} from '../../shared/core/ipc-protocol';
import {
    getBackendPath,
    getBackendPaths,
    setBackendPath,
} from './downloader-config-store';
import {
    DownloadInputError,
    validateBackendPathRequest,
    validateResolveInput,
    validateSourceUrl,
} from './downloader-guards';
import { killAll as killDownloadProcesses } from '../../../../service/downloader/subprocess';

export { killDownloadProcesses };

/**
 * Guard against sending to a destroyed BrowserWindow (e.g. user closes app mid-download).
 * win.webContents.send() throws if the window has already been destroyed.
 */
function safeSend(
    win: BrowserWindow,
    channel: string,
    ...args: unknown[]
): void {
    if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
        win.webContents.send(channel, ...args);
    }
}

// Lazy-load the downloader service to avoid pulling it in until first use.
// The service module is pure Node.js (no Electron imports).
type Mod = typeof import('../../../../service/downloader/index');
let _mod: Mod | null = null;

async function getDownloaderModules(): Promise<Mod> {
    if (!_mod) {
        _mod = await import('../../../../service/downloader/index');
    }
    return _mod;
}

// Registry of backend instances (initialised lazily)
type BackendId = 'ytdlp' | 'spotdl' | 'spytify';
type BackendRegistry = Record<
    BackendId,
    import('../../../../service/downloader/backend').DownloadBackend | null
>;

const backends: BackendRegistry = {
    ytdlp: null,
    spotdl: null,
    spytify: null,
};

let audioStore:
    import('../../../../service/downloader/audio-store').AudioStore | null =
    null;
let storeReady = false;

async function ensureStore(): Promise<
    import('../../../../service/downloader/audio-store').AudioStore
> {
    if (audioStore && storeReady) return audioStore;
    const mod = await getDownloaderModules();
    audioStore = new mod.AudioStore();
    await audioStore.init();
    storeReady = true;
    return audioStore;
}

async function getBackend(
    id: string,
): Promise<import('../../../../service/downloader/backend').DownloadBackend> {
    const mod = await getDownloaderModules();
    if (id === 'ytdlp') {
        if (!backends.ytdlp)
            backends.ytdlp = new mod.YtdlpBackend(getBackendPath('ytdlp'));
        return backends.ytdlp!;
    }
    if (id === 'spotdl') {
        if (!backends.spotdl)
            backends.spotdl = new mod.SpotdlBackend(getBackendPath('spotdl'));
        return backends.spotdl!;
    }
    if (id === 'spytify') {
        if (!backends.spytify)
            backends.spytify = new mod.SpytifyBackend(
                getBackendPath('spytify'),
            );
        return backends.spytify!;
    }
    throw new Error(`Unknown download backend: "${id}"`);
}

/**
 * Ask the user, in a native main-process dialog, to confirm a hand-typed executable.
 *
 * Only reached for paths main has no dialog record of (see `validateBackendPathRequest`).
 * The dialog is modal and blocks main, which is why it sits on the accept path only —
 * a path that does not `stat` as a regular file is refused before we get here.
 */
async function confirmBackendExecutable(
    win: BrowserWindow,
    executablePath: string,
): Promise<boolean> {
    const { response } = await dialog.showMessageBox(win, {
        type: 'warning',
        buttons: ['Cancel', 'Use this program'],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
        title: 'Confirm download tool',
        message: 'Run this program as a download tool?',
        detail:
            `WhatNext will run:\n\n${executablePath}\n\n` +
            "It runs with your user account's permissions. Only continue if you " +
            'installed this program yourself and trust it.',
    });
    return response === 1;
}

/**
 * Register all download IPC handlers.
 * Must be called after the BrowserWindow is created so we can send events back.
 */
export async function registerDownloadHandlers(
    win: BrowserWindow,
): Promise<void> {
    // Pre-init the audio store
    await ensureStore();

    // -----------------------------------------------------------------------
    // download:check-backends
    // Returns the install status of all known backends.
    // -----------------------------------------------------------------------
    ipcMain.handle(
        IPC_CHANNELS.DOWNLOAD_CHECK_BACKENDS,
        async (): Promise<BackendStatusResult[]> => {
            const [ytdlp, spotdl, spytify] = await Promise.all([
                getBackend('ytdlp').then((b) => b.checkInstalled()),
                getBackend('spotdl').then((b) => b.checkInstalled()),
                getBackend('spytify').then((b) => b.checkInstalled()),
            ]);
            return [
                { id: 'ytdlp', name: 'yt-dlp', ...ytdlp },
                { id: 'spotdl', name: 'spotDL', ...spotdl },
                { id: 'spytify', name: 'Spytify', ...spytify },
            ];
        },
    );

    // -----------------------------------------------------------------------
    // download:suggest-backend
    // Returns the suggested backend id for a given URL.
    // -----------------------------------------------------------------------
    ipcMain.handle(
        IPC_CHANNELS.DOWNLOAD_SUGGEST_BACKEND,
        async (_e, url: string): Promise<string> => {
            const mod = await getDownloaderModules();
            return mod.suggestBackend(url);
        },
    );

    // -----------------------------------------------------------------------
    // download:get-backend-paths / download:set-backend-path
    // Per-backend custom executable paths (persisted in userData).
    // -----------------------------------------------------------------------
    ipcMain.handle(
        IPC_CHANNELS.DOWNLOAD_GET_BACKEND_PATHS,
        async (): Promise<BackendPathMap> => getBackendPaths(),
    );

    // The renderer picks *which executable main spawns* here, so a bare string is not
    // enough authority: the path must either be one a main-process file dialog returned
    // or one the user confirms in a native prompt. Nothing is persisted (and nothing is
    // spawned by the `checkInstalled()` re-probe that follows) until it is accepted.
    ipcMain.handle(
        IPC_CHANNELS.DOWNLOAD_SET_BACKEND_PATH,
        async (_e, payload: unknown): Promise<SetBackendPathResult> => {
            const decision = await validateBackendPathRequest(payload, (exe) =>
                confirmBackendExecutable(win, exe),
            );

            if (!decision.ok) {
                return {
                    status:
                        decision.reason === 'declined'
                            ? 'declined'
                            : 'rejected',
                    paths: getBackendPaths(),
                    error:
                        decision.reason === 'invalid'
                            ? decision.error
                            : undefined,
                };
            }

            const updated = setBackendPath(decision.id, decision.path);
            // Invalidate the cached instance so the next call rebuilds with the new path.
            backends[decision.id] = null;
            return { status: 'saved', paths: updated };
        },
    );

    // -----------------------------------------------------------------------
    // download:resolve
    // Resolves a URL (or spotify IDs) into a list of ResolvedTrack metadata.
    // -----------------------------------------------------------------------
    ipcMain.handle(
        IPC_CHANNELS.DOWNLOAD_RESOLVE,
        async (
            _e,
            req: DownloadResolveRequest,
        ): Promise<
            import('../../../../service/downloader/types').ResolvedTrack[]
        > => {
            // Rejected before the backend is even constructed: the input becomes argv
            // for a spawned downloader, which reads a leading-dash token as an option.
            const check = validateResolveInput(req?.input);
            if (!check.ok) throw new DownloadInputError(check.error);

            const backend = await getBackend(req.backend);
            return backend.resolve(req.input);
        },
    );

    // -----------------------------------------------------------------------
    // download:start
    // Kicks off a download session. Progress/complete/error events are forwarded
    // to the renderer via win.webContents.send().
    // -----------------------------------------------------------------------
    ipcMain.handle(
        IPC_CHANNELS.DOWNLOAD_START,
        async (
            _e,
            req: import('../../../../service/downloader/types').DownloadStartRequest,
        ): Promise<void> => {
            if (!req || !Array.isArray(req.tracks)) {
                throw new DownloadInputError('no tracks were supplied');
            }
            const store = await ensureStore();

            // Auto-generate a downloadId if the caller did not provide one.
            // This ID is threaded through all events so the renderer can correlate
            // progress/complete/error events from concurrent downloads.
            const downloadId: string = req.downloadId ?? crypto.randomUUID();

            // Rejections must be *visible*: the renderer keys its progress map by the
            // exact sourceUrl it sent, so an error event has to carry that same string
            // or the track sits at "pending" forever.
            const reject = (sourceUrl: string, error: string) => {
                safeSend(win, IPC_CHANNELS.DOWNLOAD_ERROR, {
                    downloadId,
                    type: 'error',
                    sourceUrl,
                    error,
                });
            };

            // Each sourceUrl ends up as a positional argument to yt-dlp/spotDL, where a
            // leading dash is read as an option (`--exec=…` is command execution). One
            // bad URL fails its own track; the rest of the batch still runs.
            const acceptedTracks = req.tracks.filter((t) => {
                const check = validateSourceUrl(t.sourceUrl);
                if (!check.ok) {
                    reject(
                        String(t.sourceUrl),
                        new DownloadInputError(check.error).message,
                    );
                }
                return check.ok;
            });
            if (acceptedTracks.length === 0) return;

            const backend = await getBackend(req.backend);

            // Resolve each requested track to a ResolvedTrack if we only have URLs.
            // The request carries tracks with sourceUrl already set.
            const resolvedTracks = acceptedTracks.map(
                (
                    t,
                ): import('../../../../service/downloader/types').ResolvedTrack => ({
                    sourceId: '',
                    sourceUrl: t.sourceUrl,
                    sourceProvider:
                        t.sourceProvider as import('../../../../service/downloader/types').ResolvedTrack['sourceProvider'],
                    title: '',
                    artists: [],
                    album: '',
                    durationMs: 0,
                    availableFormats: [],
                }),
            );

            // Security: validate outputDir is within the allowed AudioStore base directory.
            //
            // Two hazards the naive startsWith approach misses:
            //   1. Symlinks: path.resolve() normalises `..` but does NOT dereference symlinks,
            //      so a symlink inside audioDir can escape containment. We use fs.realpathSync()
            //      on audioBase (which AudioStore guarantees exists) to resolve its real path.
            //   2. Windows case-insensitivity: startsWith is case-sensitive; normalise to
            //      lowercase on win32 before comparing.
            //
            // outputDir itself may not exist yet (it is created by the backend on first use),
            // so we cannot realpathSync it — path.relative() containment on the resolved+
            // normalised strings is the correct approach here.

            const normalize = (p: string) =>
                process.platform === 'win32' ? p.toLowerCase() : p;
            const rawOutputDir = req.outputDir ?? store.getAudioDir();
            const realBase = fs.realpathSync(store.getAudioDir());
            const resolved = path.resolve(rawOutputDir);
            const relative = path.relative(
                normalize(realBase),
                normalize(resolved),
            );
            const isContained =
                !relative.startsWith('..') && !path.isAbsolute(relative);
            const outputDir = resolved;
            if (!isContained) {
                // Per-track (not sourceUrl: '') so the renderer can actually match it —
                // see the `reject` note above.
                for (const t of acceptedTracks) {
                    reject(
                        t.sourceUrl,
                        `Download rejected: outputDir "${rawOutputDir}" is outside the allowed audio directory.`,
                    );
                }
                return;
            }

            // Run per-track downloads so each track uses its own preferredFormat.
            // We intentionally do NOT await the full loop here — it's fire-and-forget
            // from the IPC handler's perspective; events arrive via webContents.send.
            void (async () => {
                try {
                    for (let i = 0; i < resolvedTracks.length; i++) {
                        const singleTrack = resolvedTracks[i];
                        const format =
                            acceptedTracks[i]?.preferredFormat ?? 'best_audio';

                        // Dedup check — skip backend if we already have this file on disk.
                        const existingPath = store.getExisting(
                            singleTrack.sourceUrl,
                        );
                        if (existingPath) {
                            safeSend(
                                win,
                                IPC_CHANNELS.DOWNLOAD_TRACK_COMPLETE,
                                {
                                    downloadId,
                                    type: 'complete',
                                    sourceUrl: singleTrack.sourceUrl,
                                    localFilePath: existingPath,
                                },
                            );
                            continue;
                        }

                        for await (const event of backend.download(
                            [singleTrack],
                            {
                                outputDir,
                                preferredFormat: format,
                            },
                        )) {
                            if (event.type === 'progress') {
                                safeSend(win, IPC_CHANNELS.DOWNLOAD_PROGRESS, {
                                    downloadId,
                                    ...event,
                                });
                            } else if (event.type === 'complete') {
                                if (event.localFilePath) {
                                    await store.record(
                                        event.sourceUrl,
                                        event.localFilePath,
                                    );
                                }
                                safeSend(
                                    win,
                                    IPC_CHANNELS.DOWNLOAD_TRACK_COMPLETE,
                                    { downloadId, ...event },
                                );
                            } else if (event.type === 'error') {
                                safeSend(win, IPC_CHANNELS.DOWNLOAD_ERROR, {
                                    downloadId,
                                    ...event,
                                });
                            }
                        }
                    }
                } catch (err) {
                    safeSend(win, IPC_CHANNELS.DOWNLOAD_ERROR, {
                        downloadId,
                        type: 'error',
                        sourceUrl: '',
                        error: err instanceof Error ? err.message : String(err),
                    });
                }
            })();
        },
    );

    // -----------------------------------------------------------------------
    // download:cancel
    // Cancels the currently active download.
    // -----------------------------------------------------------------------
    ipcMain.handle(IPC_CHANNELS.DOWNLOAD_CANCEL, async (): Promise<void> => {
        // Cancel all backends — each cancel() is a no-op when activeProcess is null
        for (const backend of Object.values(backends)) {
            if (backend) await backend.cancel();
        }
    });
}
