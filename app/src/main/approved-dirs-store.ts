/**
 * Approved Directories Store
 *
 * Records the directories the user has explicitly chosen through a *main-process*
 * directory dialog. `shell:open-path` consults this list, so the renderer can only
 * ask us to open somewhere the user themselves pointed at (plus the app's own
 * directories) — the renderer's own `localStorage` copy of, say, the default export
 * directory is not authority, because the renderer can rewrite it at will.
 *
 * This is persisted rather than session-scoped on purpose: the "Open" button next to
 * a saved default export directory has to keep working after a restart, and the user
 * shouldn't have to re-pick the folder to earn back a permission they already granted.
 *
 * Storage: JSON file in Electron's userData directory (same shape as the relay and
 * downloader config stores).
 *   ~/.config/WhatNext/approved-dirs.json                 (Linux)
 *   ~/Library/Application Support/WhatNext/...            (macOS)
 *   %APPDATA%\WhatNext\approved-dirs.json                 (Windows)
 */

import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';

interface ApprovedDirsConfig {
    directories: string[];
}

/**
 * Upper bound on remembered directories. Each entry is a grant the user made by
 * hand, so the list grows slowly; the cap just stops a pathological session from
 * growing the file without limit. Oldest grants are dropped first.
 */
const MAX_APPROVED_DIRS = 50;

function getConfigPath(): string {
    return path.join(app.getPath('userData'), 'approved-dirs.json');
}

function readConfig(): ApprovedDirsConfig {
    try {
        const raw = fs.readFileSync(getConfigPath(), 'utf-8');
        const parsed = JSON.parse(raw) as ApprovedDirsConfig;
        if (!Array.isArray(parsed.directories)) return { directories: [] };
        return {
            directories: parsed.directories.filter(
                (d): d is string =>
                    typeof d === 'string' && d.trim().length > 0,
            ),
        };
    } catch {
        return { directories: [] };
    }
}

function writeConfig(config: ApprovedDirsConfig): void {
    try {
        fs.writeFileSync(
            getConfigPath(),
            JSON.stringify(config, null, 2),
            'utf-8',
        );
    } catch (err) {
        console.error('[ApprovedDirsStore] Failed to write config:', err);
    }
}

/** Every directory the user has approved via a main-process dialog. */
export function getApprovedDirectories(): string[] {
    return readConfig().directories;
}

/**
 * Remember a directory the user picked in a main-process dialog.
 * Returns the updated list. Non-absolute or blank input is ignored.
 */
export function recordApprovedDirectory(dirPath: string): string[] {
    const resolved = typeof dirPath === 'string' ? dirPath.trim() : '';
    if (!resolved || !path.isAbsolute(resolved))
        return getApprovedDirectories();

    const config = readConfig();
    const normalised = path.resolve(resolved);
    if (config.directories.includes(normalised)) return config.directories;

    config.directories.push(normalised);
    if (config.directories.length > MAX_APPROVED_DIRS) {
        config.directories = config.directories.slice(-MAX_APPROVED_DIRS);
    }
    writeConfig(config);
    return config.directories;
}
