/**
 * Local Media Mapper
 *
 * Maps ScannedFile objects to MappedLocalTrack records ready for RxDB import.
 * Combines the scanner output with filename parsing.
 *
 * NOTE: localFilePath and localFileSize are intentionally device-local fields.
 * They MUST NOT be replicated to P2P peers — each peer's paths differ.
 * TODO: exclude localFilePath, localFileSize from P2P replication
 * (see app/src/renderer/db/replication-handler.ts for replication context)
 */

import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import type { ScannedFile } from './scanner';
import { parseFilename } from './filename-parser';

export interface MappedLocalTrack {
    id: string; // UUID v4
    title: string;
    artists: string[];
    album: string; // Parent directory name as fallback
    durationMs: number; // 0 — not parsed from tags in Phase A
    localFilePath: string;
    localFileSize: number;
    source: 'local';
    addedAt: string; // ISO timestamp
}

/**
 * Map a single scanned file to a MappedLocalTrack.
 */
export function mapLocalFile(file: ScannedFile): MappedLocalTrack {
    const filename = path.basename(file.filePath);
    const parentDir = path.basename(path.dirname(file.filePath));
    const parsed = parseFilename(filename);

    return {
        id: uuidv4(),
        title: parsed.title,
        artists: parsed.artists,
        album: parentDir || 'Unknown Album',
        durationMs: 0,
        localFilePath: file.filePath,
        localFileSize: file.fileSize,
        source: 'local',
        addedAt: new Date().toISOString(),
    };
}

/**
 * Map an array of scanned files to MappedLocalTrack records.
 */
export function mapLocalFiles(files: ScannedFile[]): MappedLocalTrack[] {
    return files.map((file) => mapLocalFile(file));
}
