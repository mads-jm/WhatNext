/**
 * Durable replication checkpoint store (#40).
 *
 * Replaces the in-memory `Map<string, string>` in p2p-service.ts that died with
 * the utility process and forced a full resync of every collection from every
 * peer on each launch. Checkpoints are keyed `"peerId:collection"` and persisted
 * to a small JSON file so a relaunch resumes from the saved checkpoint and pulls
 * only an incremental delta.
 *
 * Ownership & location: the file lives in the Electron `userData` directory
 * (the same place relay-config.json lives — see relay-config-store.ts). The
 * utility process cannot call `app.getPath('userData')` (no `electron` module),
 * so the directory is resolved here from platform conventions, with the
 * `WHATNEXT_CHECKPOINT_PATH` env var as an explicit override (used by tests and
 * available to main if it ever wants to inject the exact path). If the derived
 * path is wrong or the file is corrupt/missing, the store starts empty and the
 * system degrades to a full resync — degraded, never broken (acceptance #40).
 *
 * Writes are debounced to avoid write amplification (one fs write per document).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

const CHECKPOINT_FILE = 'replication-checkpoints.json';
const APP_DIR_NAME = 'WhatNext';
const DEFAULT_DEBOUNCE_MS = 1000;

/** On-disk shape: a flat map of `"peerId:collection"` → checkpoint string. */
type CheckpointRecord = Record<string, string>;

/**
 * Resolve the Electron `userData` directory using platform conventions, matching
 * Electron's own defaults for app name `WhatNext`. An explicit override via
 * `WHATNEXT_CHECKPOINT_PATH` wins (it points at the *file*, not the dir).
 */
export function resolveCheckpointPath(env: NodeJS.ProcessEnv = process.env): string {
    const override = env.WHATNEXT_CHECKPOINT_PATH;
    if (override && override.trim() !== '') {
        return override;
    }

    const home = os.homedir();
    let dir: string;
    switch (process.platform) {
        case 'win32':
            dir = path.join(env.APPDATA ?? path.join(home, 'AppData', 'Roaming'), APP_DIR_NAME);
            break;
        case 'darwin':
            dir = path.join(home, 'Library', 'Application Support', APP_DIR_NAME);
            break;
        default:
            dir = path.join(env.XDG_CONFIG_HOME ?? path.join(home, '.config'), APP_DIR_NAME);
            break;
    }
    return path.join(dir, CHECKPOINT_FILE);
}

export class CheckpointStore {
    private readonly filePath: string;
    private readonly debounceMs: number;
    private cache: Map<string, string> = new Map();
    private writeTimer: ReturnType<typeof setTimeout> | null = null;
    private loaded = false;

    constructor(filePath: string, debounceMs: number = DEFAULT_DEBOUNCE_MS) {
        this.filePath = filePath;
        this.debounceMs = debounceMs;
    }

    /**
     * Load checkpoints from disk into memory. Tolerant of a missing or corrupt
     * file: on any failure the cache starts empty (→ full resync), it does not throw.
     */
    async load(): Promise<void> {
        this.loaded = true;
        try {
            const raw = await fs.promises.readFile(this.filePath, 'utf-8');
            const parsed = JSON.parse(raw) as unknown;
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                this.cache = new Map(
                    Object.entries(parsed as CheckpointRecord).filter(
                        ([k, v]) => typeof k === 'string' && typeof v === 'string'
                    )
                );
            } else {
                this.cache = new Map();
            }
        } catch {
            // Missing file (cold start) or corrupt JSON — start fresh.
            this.cache = new Map();
        }
    }

    /** Get the checkpoint for `"peerId:collection"`, or null if none stored. */
    get(key: string): string | null {
        return this.cache.get(key) ?? null;
    }

    /** All stored entries (for seeding / inspection). */
    entries(): Array<[string, string]> {
        return [...this.cache.entries()];
    }

    /**
     * Advance a checkpoint. No-ops if the value is unchanged (avoids needless
     * writes). Schedules a debounced flush to disk.
     */
    set(key: string, checkpoint: string): void {
        if (this.cache.get(key) === checkpoint) {
            return;
        }
        this.cache.set(key, checkpoint);
        this.scheduleFlush();
    }

    private scheduleFlush(): void {
        if (this.writeTimer) {
            return;
        }
        this.writeTimer = setTimeout(() => {
            this.writeTimer = null;
            void this.flush();
        }, this.debounceMs);
        // Don't keep the event loop alive solely for a pending checkpoint write.
        if (typeof this.writeTimer === 'object' && 'unref' in this.writeTimer) {
            this.writeTimer.unref();
        }
    }

    /**
     * Write the current cache to disk immediately (also cancels any pending
     * debounced write). Failures are swallowed — a checkpoint that fails to
     * persist costs at most a redundant resync, never a crash.
     */
    async flush(): Promise<void> {
        if (this.writeTimer) {
            clearTimeout(this.writeTimer);
            this.writeTimer = null;
        }
        const record: CheckpointRecord = Object.fromEntries(this.cache);
        try {
            await fs.promises.mkdir(path.dirname(this.filePath), { recursive: true });
            // Atomic-ish write: temp file + rename so a crash mid-write can't
            // leave a half-written (corrupt) checkpoint file.
            const tmp = `${this.filePath}.tmp`;
            await fs.promises.writeFile(tmp, JSON.stringify(record, null, 2), 'utf-8');
            await fs.promises.rename(tmp, this.filePath);
        } catch (err) {
            console.warn(`[CheckpointStore] Failed to persist checkpoints: ${err}`);
        }
    }

    /** Flush any pending write and stop the debounce timer. */
    async dispose(): Promise<void> {
        await this.flush();
    }

    /** Whether load() has been called (used to guard double-loads). */
    get isLoaded(): boolean {
        return this.loaded;
    }
}
