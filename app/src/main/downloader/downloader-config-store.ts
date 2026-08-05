/**
 * Downloader Configuration Store
 *
 * Persists per-backend custom executable paths to disk so users whose binary
 * is not on PATH (common on Windows, or for pyenv/pipx installs) can point
 * WhatNext at it. This lives in the *main* process because the path is consumed
 * where backends are spawned — localStorage (renderer-only) cannot reach it.
 *
 * Storage: JSON file in Electron's userData directory.
 *   ~/.config/WhatNext/downloader-config.json            (Linux)
 *   ~/Library/Application Support/WhatNext/...            (macOS)
 *   %APPDATA%\WhatNext\downloader-config.json            (Windows)
 *
 * No bundling is introduced — binaries remain user-installed. This only records
 * *where* a user-installed binary lives.
 */

import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';

export type DownloaderBackendId = 'ytdlp' | 'spotdl' | 'spytify';

const BACKEND_IDS: readonly DownloaderBackendId[] = [
    'ytdlp',
    'spotdl',
    'spytify',
];

/** A path map keyed by backend id. Absent/blank entries mean "use PATH". */
export type BackendPaths = Partial<Record<DownloaderBackendId, string>>;

interface DownloaderConfig {
    paths: BackendPaths;
}

const DEFAULT_CONFIG: DownloaderConfig = { paths: {} };

function isBackendId(id: string): id is DownloaderBackendId {
    return (BACKEND_IDS as readonly string[]).includes(id);
}

function getConfigPath(): string {
    return path.join(app.getPath('userData'), 'downloader-config.json');
}

function readConfig(): DownloaderConfig {
    try {
        const raw = fs.readFileSync(getConfigPath(), 'utf-8');
        const parsed = JSON.parse(raw) as DownloaderConfig;
        if (
            !parsed ||
            typeof parsed.paths !== 'object' ||
            parsed.paths === null
        ) {
            return { paths: {} };
        }
        // Keep only known ids with non-empty string values.
        const clean: BackendPaths = {};
        for (const id of BACKEND_IDS) {
            const value = parsed.paths[id];
            if (typeof value === 'string' && value.trim()) {
                clean[id] = value.trim();
            }
        }
        return { paths: clean };
    } catch {
        return { paths: { ...DEFAULT_CONFIG.paths } };
    }
}

function writeConfig(config: DownloaderConfig): void {
    try {
        fs.writeFileSync(
            getConfigPath(),
            JSON.stringify(config, null, 2),
            'utf-8',
        );
    } catch (err) {
        console.error('[DownloaderConfigStore] Failed to write config:', err);
    }
}

/** Return the full map of configured custom paths. */
export function getBackendPaths(): BackendPaths {
    return readConfig().paths;
}

/** Return the configured custom path for one backend, or undefined. */
export function getBackendPath(id: string): string | undefined {
    if (!isBackendId(id)) return undefined;
    return readConfig().paths[id];
}

/**
 * Set (or, with a blank/null value, clear) the custom executable path for a
 * backend. Returns the updated path map. Unknown ids are ignored.
 */
export function setBackendPath(
    id: string,
    executablePath: string | null,
): BackendPaths {
    const config = readConfig();
    if (!isBackendId(id)) return config.paths;

    const trimmed = executablePath?.trim();
    if (trimmed) {
        config.paths[id] = trimmed;
    } else {
        delete config.paths[id];
    }
    writeConfig(config);
    return config.paths;
}
