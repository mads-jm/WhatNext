import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

// ========================================
// Types
// ========================================

interface HashEntry {
    sha256: string;
    mtimeMs: number;
    size: number;
}

type HashCacheIndex = Record<string, HashEntry>;

// ========================================
// HashCache
// ========================================

/**
 * Caches SHA-256 hashes of local files.
 * Before hashing, checks if the file's mtime and size match a cached entry.
 * If they do, returns the cached hash without reading the file.
 * If not (or no entry exists), hashes the file, updates the cache, and persists.
 */
export class HashCache {
    private readonly cachePath: string;
    private index: HashCacheIndex = {};
    private dirty = false;

    /**
     * Reverse map: sha256 → absolute file path.
     * Populated as hashes are computed or loaded, for fast lookup
     * when a peer requests a file by hash.
     */
    private byHash: Map<string, string> = new Map();

    constructor(cacheDir: string) {
        this.cachePath = path.join(cacheDir, 'hashes.json');
    }

    async init(): Promise<void> {
        try {
            const raw = await fs.promises.readFile(this.cachePath, 'utf8');
            this.index = JSON.parse(raw) as HashCacheIndex;
            // Rebuild reverse map
            for (const [filePath, entry] of Object.entries(this.index)) {
                this.byHash.set(entry.sha256, filePath);
            }
        } catch (err: unknown) {
            if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
                console.warn(
                    '[HashCache] Could not parse hashes.json — starting fresh:',
                    err,
                );
            }
            this.index = {};
        }
    }

    /**
     * Returns the SHA-256 hex digest for the given file.
     * Uses the cache when the file hasn't changed (mtime + size match).
     */
    async hashFile(filePath: string): Promise<string> {
        let stat: fs.Stats;
        try {
            stat = await fs.promises.stat(filePath);
        } catch {
            throw new Error(`[HashCache] File not found: ${filePath}`);
        }

        const existing = this.index[filePath];
        if (
            existing &&
            existing.mtimeMs === stat.mtimeMs &&
            existing.size === stat.size
        ) {
            return existing.sha256;
        }

        const sha256 = await computeFileSha256(filePath);

        this.index[filePath] = {
            sha256,
            mtimeMs: stat.mtimeMs,
            size: stat.size,
        };
        this.byHash.set(sha256, filePath);
        this.dirty = true;

        await this.persist();
        return sha256;
    }

    /**
     * Look up the file path for a given sha256.
     * Returns null if not in the reverse index.
     */
    getPathBySha256(sha256: string): string | null {
        return this.byHash.get(sha256) ?? null;
    }

    /**
     * Register a file path → sha256 mapping manually (e.g. after receiving a file).
     * Also updates the forward index with the current mtime/size.
     */
    async register(filePath: string, sha256: string): Promise<void> {
        try {
            const stat = await fs.promises.stat(filePath);
            this.index[filePath] = {
                sha256,
                mtimeMs: stat.mtimeMs,
                size: stat.size,
            };
        } catch {
            // File may not exist yet (shouldn't happen, but guard anyway)
            this.index[filePath] = { sha256, mtimeMs: 0, size: 0 };
        }
        this.byHash.set(sha256, filePath);
        this.dirty = true;
        await this.persist();
    }

    private _persisting = false;
    private _pendingPersist = false;

    private async persist(): Promise<void> {
        if (!this.dirty) return;

        if (this._persisting) {
            // A write is already in-flight; flag it so we re-persist when done
            this._pendingPersist = true;
            return;
        }

        this._persisting = true;
        this.dirty = false;

        try {
            const tmpPath = `${this.cachePath}.tmp`;
            await fs.promises.writeFile(
                tmpPath,
                JSON.stringify(this.index, null, 2),
                'utf8',
            );
            try {
                await fs.promises.rename(tmpPath, this.cachePath);
            } catch (renameErr) {
                console.warn(
                    `[HashCache] Atomic rename failed, leaving tmp file at ${tmpPath}:`,
                    renameErr,
                );
            }
        } finally {
            this._persisting = false;
            if (this._pendingPersist) {
                this._pendingPersist = false;
                // Re-run persist to capture writes that arrived while we were in-flight
                await this.persist();
            }
        }
    }
}

// ========================================
// Helpers
// ========================================

export async function computeFileSha256(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const hash = crypto.createHash('sha256');
        const stream = fs.createReadStream(filePath);
        stream.on('data', (chunk) => hash.update(chunk));
        stream.on('end', () => resolve(hash.digest('hex')));
        stream.on('error', reject);
    });
}
