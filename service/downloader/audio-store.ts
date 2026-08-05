import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface AudioStoreIndex {
    [sourceUrl: string]: string; // sourceUrl → absolute file path
}

/**
 * Manages the audio file storage directory and deduplication index.
 * Prevents re-downloading tracks that have already been acquired.
 */
export class AudioStore {
    private readonly audioDir: string;
    private readonly indexPath: string;
    private index: AudioStoreIndex = {};

    constructor(audioDir?: string) {
        this.audioDir =
            audioDir ??
            path.join(os.homedir(), 'Documents', 'WhatNext', 'audio');
        this.indexPath = path.join(this.audioDir, 'index.json');
    }

    /**
     * Create necessary directories and load the existing index from disk.
     */
    async init(): Promise<void> {
        await fs.promises.mkdir(this.audioDir, { recursive: true });

        try {
            const raw = await fs.promises.readFile(this.indexPath, 'utf8');
            this.index = JSON.parse(raw) as AudioStoreIndex;
        } catch {
            // No existing index — start fresh
            this.index = {};
        }
    }

    /**
     * Returns the absolute file path if this URL was already downloaded, else null.
     */
    getExisting(sourceUrl: string): string | null {
        const filePath = this.index[sourceUrl];
        if (!filePath) return null;

        // Verify the file actually exists on disk
        try {
            fs.accessSync(filePath);
            return filePath;
        } catch {
            // File was deleted — remove stale index entry
            delete this.index[sourceUrl];
            return null;
        }
    }

    /**
     * Record a completed download in the index and persist to disk.
     */
    async record(sourceUrl: string, filePath: string): Promise<void> {
        this.index[sourceUrl] = filePath;
        await fs.promises.writeFile(
            this.indexPath,
            JSON.stringify(this.index, null, 2),
            'utf8',
        );
    }

    /**
     * Sanitise an artist + title combo into a safe filename.
     * Replaces characters forbidden on Windows/macOS/Linux.
     */
    static buildFilename(artist: string, title: string, ext: string): string {
        const sanitise = (s: string) =>
            s
                .replace(/[/\\:*?"<>|]/g, '_')
                .replace(/\s+/g, ' ')
                .trim()
                .slice(0, 100);

        const safeName = sanitise(`${artist} - ${title}`);
        const safeExt = ext.startsWith('.') ? ext : `.${ext}`;
        return `${safeName}${safeExt}`;
    }

    getAudioDir(): string {
        return this.audioDir;
    }
}
