export type InputType = 'url' | 'spotify-id' | 'spotify-playback';

export interface BackendStatus {
    installed: boolean;
    version?: string;
    path?: string;
    error?: string;
}

export interface DownloadOptions {
    outputDir: string;
    preferredFormat: string;
}

export interface DownloadBackend {
    id: string;
    name: string;
    supportedInputs: readonly InputType[];

    checkInstalled(): Promise<BackendStatus>;
    resolve(input: import('./types').DownloadInput): Promise<import('./types').ResolvedTrack[]>;
    download(
        tracks: import('./types').ResolvedTrack[],
        opts: DownloadOptions,
    ): AsyncGenerator<import('./types').DownloadEvent>;
    cancel(): Promise<void>;
}
