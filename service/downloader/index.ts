export { YtdlpBackend } from './backends/ytdlp-backend';
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

/**
 * Factory: get a download backend by id.
 * Throws if the requested backend is not registered.
 */
export function createBackend(id: string): DownloadBackend {
    switch (id) {
        case 'ytdlp':
            return new YtdlpBackend();
        default:
            throw new Error(`Unknown download backend: "${id}"`);
    }
}
