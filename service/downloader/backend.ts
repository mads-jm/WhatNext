// NOTE: `spotify-ids` (plural) deliberately matches `DownloadInput.type` in
// `./types`. A previous revision declared `spotify-id` (singular) here while the
// runtime input union used the plural form, so `SpotdlBackend`'s declared
// spotify-ids capability could never be selected by a real `DownloadInput`.
export type InputType = 'url' | 'spotify-ids' | 'spotify-playback';

export interface BackendStatus {
    installed: boolean;
    version?: string;
    path?: string;
    error?: string;
}

export interface DownloadOptions {
    outputDir: string;
    preferredFormat: string;
    /** Inactivity timeout in milliseconds. Defaults to 300 000 (5 min). */
    timeoutMs?: number;
}

export interface DownloadBackend {
    id: string;
    name: string;
    supportedInputs: readonly InputType[];

    checkInstalled(): Promise<BackendStatus>;
    resolve(
        input: import('./types').DownloadInput,
    ): Promise<import('./types').ResolvedTrack[]>;
    download(
        tracks: import('./types').ResolvedTrack[],
        opts: DownloadOptions,
    ): AsyncGenerator<import('./types').DownloadEvent>;
    cancel(): Promise<void>;
}
