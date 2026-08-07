import * as fs from 'fs';
import * as path from 'path';
import type {
    FileManifest,
    FileEntry,
} from '../../shared/core/file-transfer-types';
import { HashCache } from './hash-cache';

// ========================================
// MIME helpers
// ========================================

function audioMime(ext: string): string {
    const table: Record<string, string> = {
        mp3: 'audio/mpeg',
        opus: 'audio/ogg',
        ogg: 'audio/ogg',
        aac: 'audio/aac',
        m4a: 'audio/mp4',
        flac: 'audio/flac',
        wav: 'audio/wav',
        webm: 'audio/webm',
    };
    return table[ext.toLowerCase().replace(/^\./, '')] ?? 'audio/mpeg';
}

function imageMime(ext: string): string {
    const table: Record<string, string> = {
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        png: 'image/png',
        webp: 'image/webp',
    };
    return table[ext.toLowerCase().replace(/^\./, '')] ?? 'image/jpeg';
}

// ========================================
// buildManifest
// ========================================

/**
 * Builds a FileManifest for a playlist.
 *
 * @param peerId        - Our own libp2p peer ID (string)
 * @param playlistId    - RxDB playlist ID
 * @param trackIds      - Ordered list of RxDB track IDs in the playlist
 * @param lookupAudioPath  - Called per trackId; returns absolute path to local audio, or null
 * @param lookupArtworkPath - Called per trackId; returns absolute path to local artwork, or null
 * @param lookupCoverArtPath - Returns the absolute path to the playlist cover art, or null
 * @param hashCache     - Shared HashCache instance for deduplication and reuse
 */
export async function buildManifest(
    peerId: string,
    playlistId: string,
    trackIds: string[],
    lookupAudioPath: (trackId: string) => string | null,
    lookupArtworkPath: (trackId: string) => string | null,
    lookupCoverArtPath: () => string | null,
    hashCache: HashCache,
): Promise<FileManifest> {
    const files: FileEntry[] = [];

    // Process each track
    for (const trackId of trackIds) {
        // Audio
        const audioPath = lookupAudioPath(trackId);
        if (audioPath) {
            const entry = await buildAudioEntry(trackId, audioPath, hashCache);
            if (entry) files.push(entry);
        }

        // Per-track artwork
        const artworkPath = lookupArtworkPath(trackId);
        if (artworkPath) {
            const entry = await buildImageEntry(
                trackId,
                'artwork',
                artworkPath,
                hashCache,
            );
            if (entry) files.push(entry);
        }
    }

    // Playlist cover art
    const coverPath = lookupCoverArtPath();
    if (coverPath) {
        const entry = await buildImageEntry(
            playlistId,
            'cover-art',
            coverPath,
            hashCache,
        );
        if (entry) files.push(entry);
    }

    return {
        peerId,
        playlistId,
        files,
        generatedAt: new Date().toISOString(),
    };
}

// ========================================
// Entry builders
// ========================================

async function buildAudioEntry(
    trackId: string,
    filePath: string,
    hashCache: HashCache,
): Promise<FileEntry | null> {
    let stat: fs.Stats;
    try {
        stat = await fs.promises.stat(filePath);
    } catch {
        return null;
    }

    let sha256: string;
    try {
        sha256 = await hashCache.hashFile(filePath);
    } catch {
        return null;
    }

    const ext = path.extname(filePath).replace(/^\./, '');
    const filename = path.basename(filePath);

    return {
        trackId,
        type: 'audio',
        sha256,
        sizeBytes: stat.size,
        mimeType: audioMime(ext),
        filename,
        audioFormat: ext || undefined,
    };
}

async function buildImageEntry(
    id: string,
    type: 'artwork' | 'cover-art',
    filePath: string,
    hashCache: HashCache,
): Promise<FileEntry | null> {
    let stat: fs.Stats;
    try {
        stat = await fs.promises.stat(filePath);
    } catch {
        return null;
    }

    let sha256: string;
    try {
        sha256 = await hashCache.hashFile(filePath);
    } catch {
        return null;
    }

    const ext = path.extname(filePath).replace(/^\./, '');
    const filename = path.basename(filePath);

    return {
        trackId: id,
        type,
        sha256,
        sizeBytes: stat.size,
        mimeType: imageMime(ext),
        filename,
    };
}
