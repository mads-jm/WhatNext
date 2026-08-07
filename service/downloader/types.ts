export interface ResolvedTrack {
    sourceId: string;
    sourceUrl: string;
    sourceProvider: 'youtube' | 'soundcloud' | 'bandcamp' | 'spotify';
    title: string;
    artists: string[];
    album: string;
    durationMs: number;
    thumbnailUrl?: string;
    availableFormats: AudioFormatOption[];
    spotifyId?: string;
}

export interface AudioFormatOption {
    formatId: string;
    codec: string; // 'opus' | 'aac' | 'mp3' | 'flac' | 'wav'
    bitrate?: number; // kbps
    filesize?: number; // bytes, estimated
}

export interface DownloadInput {
    type: 'url' | 'spotify-ids';
    url?: string;
    spotifyIds?: string[];
}

export interface DownloadStartRequest {
    backend: string; // 'ytdlp' | 'spotdl' | 'spytify'
    tracks: Array<{
        sourceUrl: string;
        sourceProvider: string;
        preferredFormat: string; // 'best_audio' | 'opus' | 'mp3' | 'flac'
    }>;
    outputDir?: string;
    /** Optional caller-supplied correlation ID. Auto-generated (UUID) if omitted. */
    downloadId?: string;
}

export interface DownloadEvent {
    type: 'progress' | 'complete' | 'error';
    sourceUrl: string;
    /** Correlation ID added at the IPC layer when forwarding events to the renderer. */
    downloadId?: string;
    percent?: number;
    speed?: string;
    eta?: string;
    localFilePath?: string;
    audioFormat?: string;
    audioBitrate?: number;
    error?: string;
}

export interface PurchaseResolveRequest {
    title: string;
    artists: string[];
    album?: string;
}

export interface PurchaseLink {
    provider: string; // 'bandcamp' | 'beatport' | 'itunes' | 'amazon'
    url: string;
    label?: string; // e.g. "Buy on Bandcamp ($1+)"
    resolvedAt: string; // ISO timestamp
}
