/**
 * Path Safety — shared filesystem containment and sanitisation helpers.
 *
 * These started life private to `file-transfer/file-transfer-ipc.ts`, guarding
 * peer-supplied filenames. The renderer-facing IPC guards need exactly the same
 * containment semantics (including the Windows case-folding and the `+ path.sep`
 * prefix guard), so they live here as the single copy both sides import.
 *
 * Everything here is pure — no Electron, no fs, no module state — so it is
 * directly unit-testable and safe to import from either process-side module.
 */

import * as path from 'path';

/**
 * Sanitize a filename received from a remote peer.
 *
 * Defends against path traversal attacks (e.g. `../../.ssh/authorized_keys`).
 * Steps:
 *   1. `path.basename()` — strips any directory prefix
 *   2. Remove all remaining path separators and `..` sequences
 *   3. Strip OS-illegal characters
 *   4. Fallback to `{sha256prefix}.{ext}` if result is empty
 *
 * @param filename   - Raw filename from the remote peer
 * @param sha256     - Transfer hash; used as fallback name base
 * @returns          - Safe filename with no directory components
 */
export function sanitizeFilename(filename: string, sha256: string): string {
    // Step 1: strip directory components
    let safe = path.basename(filename);

    // Step 2: strip remaining path separators and `..` sequences
    safe = safe.replace(/[/\\]/g, '').replace(/\.\./g, '');

    // Step 3: strip OS-illegal characters (Windows superset — safe on all platforms)
    // Illegal: < > : " | ? * \x00-\x1f and leading/trailing dots/spaces
    // eslint-disable-next-line no-control-regex
    safe = safe.replace(/[<>:"|?*\x00-\x1f]/g, '');
    safe = safe.trim().replace(/^\.+/, '').replace(/\.+$/, '');

    // Step 4: fallback if result is empty
    if (safe.length === 0) {
        const ext = path.extname(filename).replace(/[^a-zA-Z0-9]/g, '') || 'bin';
        safe = `${sha256.slice(0, 8)}.${ext}`;
        return safe;
    }

    // Step 5: if trailing-dot strip removed the extension, restore it from the original
    // (e.g. "song." → "song" loses its extension slot; re-derive from original filename)
    if (path.extname(safe) === '') {
        const originalExt = path.extname(filename).replace(/[^a-zA-Z0-9.]/g, '');
        if (originalExt.length > 1) {
            // Guard: if `safe` is already just the bare extension (e.g. "...mp3" stripped
            // to "mp3"), appending would produce "mp3.mp3". Detect this and use the hash
            // prefix as the stem instead.
            const bareExt = originalExt.slice(1); // e.g. "mp3"
            if (safe.toLowerCase() === bareExt.toLowerCase()) {
                safe = `${sha256.slice(0, 8)}.${bareExt}`;
            } else {
                // originalExt is e.g. ".mp3" — safe to append
                safe = `${safe}${originalExt}`;
            }
        } else {
            // Original had no meaningful extension either — apply .bin fallback
            safe = `${safe}.bin`;
        }
    }

    return safe;
}

/**
 * Validate that a sha256 value is a 64-character lowercase hex string.
 * Rejects path-traversal payloads such as "../../.config/attack".
 */
export function isValidSha256(hash: string): boolean {
    return /^[a-f0-9]{64}$/i.test(hash);
}

/**
 * True when `candidatePath` resolves to `targetDir` itself or something beneath it.
 * Both sides are resolved first, so `..` segments are collapsed before comparison.
 */
export function isPathContained(candidatePath: string, targetDir: string): boolean {
    const resolvedTarget = path.resolve(targetDir);
    const normalised = path.resolve(candidatePath);

    // On Windows paths are case-insensitive — compare lowercased to avoid false positives
    // (e.g. C:\Users\Joe\Audio vs c:\users\joe\audio).
    const cmp = (a: string, b: string): boolean =>
        process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
    const startsWith = (a: string, prefix: string): boolean =>
        process.platform === 'win32'
            ? a.toLowerCase().startsWith(prefix.toLowerCase())
            : a.startsWith(prefix);

    // Append sep so that a dir named "audioExtra" doesn't match "audio" prefix check
    return startsWith(normalised, resolvedTarget + path.sep) || cmp(normalised, resolvedTarget);
}

/**
 * Assert the resolved path is inside targetDir (or is targetDir itself).
 * Throws if the path escapes — call site should abort the operation.
 */
export function assertPathContained(resolvedPath: string, targetDir: string): void {
    if (!isPathContained(resolvedPath, targetDir)) {
        throw new Error(
            `Path traversal rejected: '${resolvedPath}' escapes target dir '${targetDir}'`,
        );
    }
}
