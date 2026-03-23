/**
 * Media Directory Scanner
 *
 * Recursively walks a directory and collects audio files.
 * Ported from TapeC's walkDir pattern, adapted to TypeScript + async fs.
 * Intentionally has no knowledge of tracks or RxDB — pure filesystem concern.
 */

import * as fs from 'fs/promises';
import type { Dirent } from 'fs';
import * as path from 'path';

/** Supported audio file extensions (lowercase, with dot). */
const SUPPORTED_EXTENSIONS = new Set([
    '.mp3',
    '.flac',
    '.wav',
    '.aac',
    '.opus',
    '.ogg',
    '.m4a',
    '.wma',
    '.aiff',
    '.aif',
]);

export interface ScannedFile {
    filePath: string; // Absolute path to the audio file
    fileSize: number; // Size in bytes
    ext: string; // Extension including dot, lowercased (e.g. '.mp3')
}

export interface ScanResult {
    files: ScannedFile[];
    stats: {
        scanned: number; // Total entries examined (files + dirs)
        supported: number; // Audio files collected
        skipped: number; // Non-audio files skipped
    };
}

/**
 * Recursively scan a directory for supported audio files.
 * Symlinks are followed for files, not for directories (to avoid cycles).
 */
export async function scanDirectory(dirPath: string): Promise<ScanResult> {
    const result: ScanResult = {
        files: [],
        stats: { scanned: 0, supported: 0, skipped: 0 },
    };

    await walkDir(dirPath, result);

    return result;
}

async function walkDir(dirPath: string, result: ScanResult): Promise<void> {
    let entries: Dirent[];
    try {
        entries = await fs.readdir(dirPath, { withFileTypes: true });
    } catch (err) {
        console.warn(`[Scanner] Cannot read directory: ${dirPath}`, err);
        return;
    }

    for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        result.stats.scanned++;

        if (entry.isDirectory()) {
            await walkDir(fullPath, result);
        } else if (entry.isFile() || entry.isSymbolicLink()) {
            const ext = path.extname(entry.name).toLowerCase();
            if (SUPPORTED_EXTENSIONS.has(ext)) {
                try {
                    const stat = await fs.stat(fullPath);
                    result.files.push({
                        filePath: fullPath,
                        fileSize: stat.size,
                        ext,
                    });
                    result.stats.supported++;
                } catch (err) {
                    console.warn(`[Scanner] Cannot stat file: ${fullPath}`, err);
                    result.stats.skipped++;
                }
            } else {
                result.stats.skipped++;
            }
        }
    }
}
