/**
 * Local Media Mapper
 *
 * Maps ScannedFile objects to MappedLocalTrack records ready for RxDB import.
 * Reads audio metadata (ID3v2, Vorbis, etc.) via music-metadata, falling back
 * to filename parsing when tags are absent.
 *
 * NOTE: localFilePath and localFileSize are intentionally device-local fields.
 * They MUST NOT be replicated to P2P peers — each peer's paths differ.
 * Stripping happens in useSessionReplication before push.
 */

import * as path from 'path';
import * as mm from 'music-metadata';
import { v4 as uuidv4 } from 'uuid';
import type { ScannedFile } from './scanner';
import { parseFilename } from './filename-parser';

export interface MappedLocalTrack {
    id: string; // UUID v4
    title: string;
    artists: string[];
    album: string; // Parent directory name as fallback
    durationMs: number;
    localFilePath: string;
    localFileSize: number;
    source: 'local';
    addedAt: string; // ISO timestamp
    audioFormat?: string;
    audioBitrate?: number;
}

/**
 * Read audio metadata from a file using music-metadata.
 * Returns null if parsing fails (corrupt file, unsupported format, etc.).
 */
async function readAudioTags(filePath: string) {
    try {
        return await mm.parseFile(filePath, { skipCovers: true });
    } catch (err) {
        console.warn(`[LocalMediaMapper] Failed to read tags from: ${filePath}`, err);
        return null;
    }
}

/**
 * Map a single scanned file to a MappedLocalTrack.
 * Reads embedded audio tags; falls back to filename parsing for missing fields.
 */
export async function mapLocalFile(file: ScannedFile): Promise<MappedLocalTrack> {
    const filename = path.basename(file.filePath);
    const parentDir = path.basename(path.dirname(file.filePath));
    const parsed = parseFilename(filename);

    const metadata = await readAudioTags(file.filePath);
    const common = metadata?.common;
    const format = metadata?.format;

    // Prefer tags, fall back to filename parsing
    const title = common?.title || parsed.title;

    // Artists: prefer tag artist (split on delimiters), fall back to filename
    let artists: string[];
    if (common?.artists && common.artists.length > 0) {
        artists = common.artists;
    } else if (common?.artist) {
        artists = common.artist.split(/[,;&]/).map((a) => a.trim()).filter(Boolean);
    } else {
        artists = parsed.artists;
    }

    const album = common?.album || parentDir || 'Unknown Album';
    const durationMs = format?.duration ? Math.round(format.duration * 1000) : 0;

    // Audio format info
    const audioFormat = file.ext.replace('.', '') || undefined;
    const audioBitrate = format?.bitrate ? Math.round(format.bitrate / 1000) : undefined;

    return {
        id: uuidv4(),
        title,
        artists,
        album,
        durationMs,
        localFilePath: file.filePath,
        localFileSize: file.fileSize,
        source: 'local',
        addedAt: new Date().toISOString(),
        audioFormat,
        audioBitrate,
    };
}

/**
 * Map an array of scanned files to MappedLocalTrack records.
 * Reads tags concurrently with bounded parallelism.
 */
export async function mapLocalFiles(files: ScannedFile[]): Promise<MappedLocalTrack[]> {
    // Process in batches of 10 to avoid overwhelming the filesystem
    const BATCH_SIZE = 10;
    const results: MappedLocalTrack[] = [];

    for (let i = 0; i < files.length; i += BATCH_SIZE) {
        const batch = files.slice(i, i + BATCH_SIZE);
        const mapped = await Promise.all(batch.map((file) => mapLocalFile(file)));
        results.push(...mapped);
    }

    return results;
}
