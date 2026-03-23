export { YtdlpBackend } from './backends/ytdlp-backend';
export { SpotdlBackend } from './backends/spotdl-backend';
export type { DownloadBackend, BackendStatus, DownloadOptions } from './backend';
export type {
    ResolvedTrack,
    AudioFormatOption,
    DownloadInput,
    DownloadStartRequest,
    DownloadEvent,
    PurchaseResolveRequest,
} from './types';
export { AudioStore } from './audio-store';

import type { DownloadBackend } from './backend';
import { YtdlpBackend } from './backends/ytdlp-backend';
import { SpotdlBackend } from './backends/spotdl-backend';

/**
 * Factory: get a download backend by id.
 * Throws if the requested backend is not registered.
 */
export function createBackend(id: string): DownloadBackend {
    switch (id) {
        case 'ytdlp':
            return new YtdlpBackend();
        case 'spotdl':
            return new SpotdlBackend();
        default:
            throw new Error(`Unknown download backend: "${id}"`);
    }
}

/**
 * Suggest the best backend for a given URL.
 * Returns 'spotdl' for Spotify URLs, 'ytdlp' otherwise.
 */
export function suggestBackend(url: string): string {
    return url.includes('spotify.com') ? 'spotdl' : 'ytdlp';
}
