import { ipcMain, BrowserWindow } from 'electron';
import { IPC_CHANNELS } from '../../shared/core/ipc-protocol';
import type {
    BackendStatusResult,
    DownloadResolveRequest,
} from '../../shared/core/ipc-protocol';

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
type BackendRegistry = Record<BackendId, import('../../../../service/downloader/backend').DownloadBackend | null>;

const backends: BackendRegistry = {
    ytdlp: null,
    spotdl: null,
    spytify: null,
};

let audioStore: import('../../../../service/downloader/audio-store').AudioStore | null = null;
let storeReady = false;

async function ensureStore(): Promise<import('../../../../service/downloader/audio-store').AudioStore> {
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
        if (!backends.ytdlp) backends.ytdlp = new mod.YtdlpBackend();
        return backends.ytdlp!;
    }
    if (id === 'spotdl') {
        if (!backends.spotdl) backends.spotdl = new mod.SpotdlBackend();
        return backends.spotdl!;
    }
    if (id === 'spytify') {
        if (!backends.spytify) backends.spytify = new mod.SpytifyBackend();
        return backends.spytify!;
    }
    throw new Error(`Unknown download backend: "${id}"`);
}

/**
 * Register all download IPC handlers.
 * Must be called after the BrowserWindow is created so we can send events back.
 */
export async function registerDownloadHandlers(win: BrowserWindow): Promise<void> {
    // Pre-init the audio store
    await ensureStore();

    // -----------------------------------------------------------------------
    // download:check-backends
    // Returns the install status of all known backends.
    // -----------------------------------------------------------------------
    ipcMain.handle(IPC_CHANNELS.DOWNLOAD_CHECK_BACKENDS, async (): Promise<BackendStatusResult[]> => {
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
    });

    // -----------------------------------------------------------------------
    // download:suggest-backend
    // Returns the suggested backend id for a given URL.
    // -----------------------------------------------------------------------
    ipcMain.handle(IPC_CHANNELS.DOWNLOAD_SUGGEST_BACKEND, async (_e, url: string): Promise<string> => {
        const mod = await getDownloaderModules();
        return mod.suggestBackend(url);
    });

    // -----------------------------------------------------------------------
    // download:resolve
    // Resolves a URL (or spotify IDs) into a list of ResolvedTrack metadata.
    // -----------------------------------------------------------------------
    ipcMain.handle(
        IPC_CHANNELS.DOWNLOAD_RESOLVE,
        async (
            _e,
            req: DownloadResolveRequest,
        ): Promise<import('../../../../service/downloader/types').ResolvedTrack[]> => {
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
            const store = await ensureStore();
            const backend = await getBackend(req.backend);

            // Resolve each requested track to a ResolvedTrack if we only have URLs.
            // The request carries tracks with sourceUrl already set.
            const resolvedTracks = req.tracks.map(
                (t): import('../../../../service/downloader/types').ResolvedTrack => ({
                    sourceId: '',
                    sourceUrl: t.sourceUrl,
                    sourceProvider: t.sourceProvider as import('../../../../service/downloader/types').ResolvedTrack['sourceProvider'],
                    title: '',
                    artists: [],
                    album: '',
                    durationMs: 0,
                    availableFormats: [],
                }),
            );

            const outputDir = req.outputDir ?? store.getAudioDir();

            // Run per-track downloads so each track uses its own preferredFormat.
            // We intentionally do NOT await the full loop here — it's fire-and-forget
            // from the IPC handler's perspective; events arrive via webContents.send.
            void (async () => {
                try {
                    for (let i = 0; i < resolvedTracks.length; i++) {
                        const singleTrack = resolvedTracks[i];
                        const format = req.tracks[i]?.preferredFormat ?? 'best_audio';

                        // Dedup check — skip backend if we already have this file on disk.
                        const existingPath = store.getExisting(singleTrack.sourceUrl);
                        if (existingPath) {
                            win.webContents.send(IPC_CHANNELS.DOWNLOAD_TRACK_COMPLETE, {
                                type: 'complete',
                                sourceUrl: singleTrack.sourceUrl,
                                localFilePath: existingPath,
                            });
                            continue;
                        }

                        for await (const event of backend.download([singleTrack], {
                            outputDir,
                            preferredFormat: format,
                        })) {
                            if (event.type === 'progress') {
                                win.webContents.send(IPC_CHANNELS.DOWNLOAD_PROGRESS, event);
                            } else if (event.type === 'complete') {
                                if (event.localFilePath) {
                                    await store.record(event.sourceUrl, event.localFilePath);
                                }
                                win.webContents.send(IPC_CHANNELS.DOWNLOAD_TRACK_COMPLETE, event);
                            } else if (event.type === 'error') {
                                win.webContents.send(IPC_CHANNELS.DOWNLOAD_ERROR, event);
                            }
                        }
                    }
                } catch (err) {
                    win.webContents.send(IPC_CHANNELS.DOWNLOAD_ERROR, {
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
        if (backends.ytdlp) {
            await backends.ytdlp.cancel();
        }
    });
}
