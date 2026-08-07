/**
 * Audio Filename Parser
 *
 * Extracts structured metadata from bare audio filenames.
 * Handles the common pattern: "Artist - Title (Year).mp3"
 *
 * Strategy (in order):
 * 1. Strip extension
 * 2. Extract year from last parenthesised group at the end, e.g. "(2021)"
 * 3. Split on " - " to separate artist(s) from title
 * 4. If no separator found, use the full name as title with unknown artist
 */

import * as path from 'path';

export interface ParsedFilename {
    title: string;
    artists: string[]; // May be empty if no separator was found
    year?: number; // Extracted from trailing "(YYYY)" pattern
}

/**
 * Parse an audio filename into structured metadata.
 * @param filename - The bare filename, with or without extension.
 */
export function parseFilename(filename: string): ParsedFilename {
    // Strip file extension if present
    const withoutExt = path.extname(filename)
        ? filename.slice(0, filename.length - path.extname(filename).length)
        : filename;

    // Extract year from trailing "(YYYY)" — e.g. "My Song (2021)" → year 2021
    let base = withoutExt.trim();
    let year: number | undefined;

    const yearMatch = base.match(/\((\d{4})\)\s*$/);
    if (yearMatch) {
        const parsed = parseInt(yearMatch[1], 10);
        // Sanity-check: music years roughly 1900–2100
        if (parsed >= 1900 && parsed <= 2100) {
            year = parsed;
            base = base.slice(0, yearMatch.index).trim();
        }
    }

    // Split on " - " to separate artist from title
    const separatorIndex = base.indexOf(' - ');
    if (separatorIndex !== -1) {
        const artistPart = base.slice(0, separatorIndex).trim();
        const titlePart = base.slice(separatorIndex + 3).trim();

        // Multiple artists may be separated by ", " or " & " — split on ", " only
        const artists = artistPart
            .split(',')
            .map((a) => a.trim())
            .filter(Boolean);

        return {
            title: titlePart || base,
            artists,
            year,
        };
    }

    // No separator found: use full name as title
    return {
        title: base || filename,
        artists: [],
        year,
    };
}
