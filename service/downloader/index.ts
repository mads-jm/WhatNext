export { YtdlpBackend } from './backends/ytdlp-backend';
export { SpotdlBackend } from './backends/spotdl-backend';
export { SpytifyBackend } from './backends/spytify-backend';
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
export { PurchaseResolver } from './purchase-resolver';
export type { PurchaseLink } from './types';

import type { DownloadBackend } from './backend';
import { YtdlpBackend } from './backends/ytdlp-backend';
import { SpotdlBackend } from './backends/spotdl-backend';
import { SpytifyBackend } from './backends/spytify-backend';

/**
 * Factory: get a download backend by id.
 * Throws if the requested backend is not registered.
 *
 * @param execPath Optional user-configured executable path for the backend.
 *   When omitted, the backend resolves its bare command name via PATH.
 */
export function createBackend(id: string, execPath?: string): DownloadBackend {
    switch (id) {
        case 'ytdlp':
            return new YtdlpBackend(execPath);
        case 'spotdl':
            return new SpotdlBackend(execPath);
        case 'spytify':
            return new SpytifyBackend(execPath);
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
