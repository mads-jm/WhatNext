/**
 * Artwork IPC — Main Process
 *
 * Owns the artwork cache: downloading album/playlist cover art to
 * `Documents/WhatNext/artwork`, naming the files after album/artist for
 * local-first legibility, and maintaining the `index.json` that maps remote
 * URL → local filename so a cover is fetched at most once.
 *
 * Handlers register during module evaluation of main.ts, exactly as they did
 * when they lived there — `registerArtworkHandlers` is called at the same
 * point in main.ts's synchronous execution, not from `app.whenReady()`.
 *
 * Reading these files back out is a separate concern: the renderer fetches
 * them over the `wn-art://` protocol, which main.ts registers and
 * `ipc-guards.resolveArtworkPath` confines to the artwork roots.
 */

import { app, ipcMain } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

/** Strip filesystem-illegal characters and trim to a safe length. */
function sanitizePathSegment(str: string): string {
    return (
        str
            // Matching C0 control characters is the entire point of the class:
            // they are illegal in filenames on every platform we ship to. The rule
            // guards against *accidental* control characters, so there is no real
            // fix here — same deliberate exception as `path-safety.ts` and the two
            // URL guards; rewriting the range in \u escape form does not silence it.
            // eslint-disable-next-line no-control-regex
            .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')
            .trim()
            .slice(0, 80)
    );
}

/**
 * Build human-readable base filename from album/artist metadata.
 * Returns null if insufficient metadata — caller falls back to hash.
 */
function artworkBaseName(
    albumName?: string,
    artistName?: string,
): string | null {
    if (!albumName) return null;
    const album = sanitizePathSegment(albumName);
    if (!album) return null;
    if (artistName) {
        const artist = sanitizePathSegment(artistName);
        if (artist) return `${artist} - ${album}`;
    }
    return album;
}

/**
 * Register the artwork IPC handlers.
 * Must be called during main.ts's module evaluation.
 */
export function registerArtworkHandlers(): void {
    /**
     * Download and cache artwork (album art or playlist cover) from a remote URL.
     * Files are named by album/artist for local-first legibility.
     * An index.json in the artwork directory maps remote URL → local filename
     * for deduplication without re-downloading.
     */
    ipcMain.handle(
        'artwork:download',
        async (
            _event,
            req: { url: string; albumName?: string; artistName?: string },
        ) => {
            try {
                const { url, albumName, artistName } = req;
                const artworkDir = path.join(
                    app.getPath('documents'),
                    'WhatNext',
                    'artwork',
                );
                await fs.promises.mkdir(artworkDir, { recursive: true });

                // Load index: url → filename
                const indexPath = path.join(artworkDir, 'index.json');
                let index: Record<string, string> = {};
                try {
                    index = JSON.parse(
                        await fs.promises.readFile(indexPath, 'utf-8'),
                    );
                } catch {
                    /* no index yet */
                }

                // Return cached path if index entry exists and file is present
                if (index[url]) {
                    const cachedPath = path.join(artworkDir, index[url]);
                    try {
                        await fs.promises.access(cachedPath);
                        return { success: true, localPath: cachedPath };
                    } catch {
                        delete index[url]; // stale entry — re-download
                    }
                }

                // Build human-readable filename; fall back to URL hash
                const indexedNames = new Set(Object.values(index));
                const baseName = artworkBaseName(albumName, artistName);
                let filename: string;
                if (baseName) {
                    let candidate = `${baseName}.jpg`;
                    let n = 2;
                    while (indexedNames.has(candidate))
                        candidate = `${baseName}-${n++}.jpg`;
                    filename = candidate;
                } else {
                    const rawId =
                        new URL(url).pathname
                            .split('/')
                            .filter(Boolean)
                            .pop() ?? '';
                    const imageId =
                        rawId.replace(/[^a-zA-Z0-9_-]/g, '') ||
                        Buffer.from(url).toString('base64url').slice(0, 40);
                    filename = `${imageId}.jpg`;
                }

                const localPath = path.join(artworkDir, filename);
                const response = await fetch(url);
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                await fs.promises.writeFile(
                    localPath,
                    Buffer.from(await response.arrayBuffer()),
                );

                // Persist index
                index[url] = filename;
                await fs.promises.writeFile(
                    indexPath,
                    JSON.stringify(index, null, 2),
                );

                return { success: true, localPath };
            } catch (error) {
                console.error('[Main] artwork:download failed:', error);
                return { success: false, error: String(error) };
            }
        },
    );
}
