/**
 * IPC Guards — the trust boundary for renderer-supplied strings in `main.ts`.
 *
 * The renderer is treated as untrusted (CLAUDE.md constraint #4). Four handlers in
 * `main.ts` used to take a renderer string straight to an OS capability:
 *
 *   - `shell:open-external`  → `exec()`         (shell injection)
 *   - `shell:open-path`      → `shell.openPath` (arbitrary open == arbitrary execute on files)
 *   - `wn-art://`            → `fs.readFile`    (arbitrary file read)
 *   - `file:write`           → `fs.writeFile`   (arbitrary file write)
 *
 * Each entry point gets one exported check here, so the validation is importable and
 * testable on its own rather than buried inside a handler closure.
 *
 * Authority model: for anything the user must be free to point anywhere (export
 * targets, the folder the "Open" button reveals), authority comes from the user's own
 * *main-process* dialog choice — recorded here at dialog time — not from a hardcoded
 * allowlist of app directories. That keeps sovereignty (CLAUDE.md #1/#2) intact while
 * still refusing paths the renderer invented on its own.
 */

import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { isPathContained } from './utils/path-safety';
import { getApprovedDirectories } from './approved-dirs-store';

// ========================================
// shell:open-external
// ========================================

export type ExternalUrlCheck = { ok: true; url: string } | { ok: false; error: string };

/** Protocols we hand to the OS browser. */
const WEB_PROTOCOLS = ['http:', 'https:'];

/**
 * Custom app URIs we allow, with a strict shape per scheme. Anything that is not a
 * bare scheme or `scheme:seg:seg…` of URI-safe characters is rejected, so a payload
 * like `spotify:" & calc & "` never reaches the OS at all.
 */
const APP_URI_PATTERNS: Record<string, RegExp> = {
    'spotify:': /^spotify:(?:[A-Za-z0-9._-]+(?::[A-Za-z0-9._-]+)*)?$/,
};

/** Longer than any legitimate share link; bounds the work done below. */
const MAX_URL_LENGTH = 2048;

/** C0/C1 control characters — never valid inside a URL we open. */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/;

/**
 * Validate a URL the renderer wants opened externally.
 *
 * Note there is deliberately no shell anywhere downstream of this: `shell.openExternal`
 * hands the URI to the OS through an API call, not a command line. The pattern check is
 * the second layer — it keeps malformed URIs from reaching the OS handler at all.
 */
export function validateExternalUrl(raw: unknown): ExternalUrlCheck {
    if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_URL_LENGTH) {
        return { ok: false, error: 'Invalid URL' };
    }
    if (CONTROL_CHARS.test(raw)) {
        return { ok: false, error: 'Invalid URL' };
    }

    let parsed: URL;
    try {
        parsed = new URL(raw);
    } catch {
        return { ok: false, error: 'Invalid URL' };
    }

    if (WEB_PROTOCOLS.includes(parsed.protocol)) {
        // Hand the OS the parsed form: percent-encoded and normalised, so a link with
        // an odd literal character can still open without us forwarding it verbatim.
        return { ok: true, url: parsed.href };
    }

    const pattern = APP_URI_PATTERNS[parsed.protocol];
    if (!pattern) {
        return { ok: false, error: 'Invalid protocol' };
    }
    if (!pattern.test(raw)) {
        return { ok: false, error: 'Malformed URI' };
    }
    return { ok: true, url: raw };
}

// ========================================
// wn-art:// (artwork reads)
// ========================================

/** Extensions the artwork protocol can serve — matches the handler's MIME table. */
const ARTWORK_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'];

/**
 * Every directory artwork may legitimately live in.
 *  - `<documents>/WhatNext/artwork` — the `artwork:download` cache *and* the
 *    file-transfer receive directory for peer-sent covers (same folder).
 *  - `<userData>/artwork` — where the cache lived before it moved into Documents;
 *    still referenced by `albumArtLocalPath` values written by older builds.
 */
export function getArtworkRoots(): string[] {
    return [
        path.join(app.getPath('documents'), 'WhatNext', 'artwork'),
        path.join(app.getPath('userData'), 'artwork'),
    ];
}

/**
 * Resolve a `wn-art://` request path, or null if it is not a servable artwork file.
 *
 * Rejects relative paths, traversal out of the artwork roots, absolute paths that were
 * never under a root, and non-image extensions. Returns the resolved path to read.
 */
export function resolveArtworkPath(raw: unknown): string | null {
    if (typeof raw !== 'string' || raw.length === 0) return null;
    if (raw.includes('\0')) return null;
    if (!path.isAbsolute(raw)) return null;

    const resolved = path.resolve(raw);
    if (!ARTWORK_EXTENSIONS.includes(path.extname(resolved).toLowerCase())) return null;

    const permitted = getArtworkRoots().some((root) => isPathContained(resolved, root));
    return permitted ? resolved : null;
}

// ========================================
// file:write (export targets)
// ========================================

/**
 * Save paths the user approved via `dialog:save-file` and that have not been written yet.
 * One-shot: a write consumes the approval, so a renderer that captured a path cannot keep
 * rewriting the file later. Session-scoped by design — nothing persists across restarts.
 */
const pendingSaveTargets = new Set<string>();

/** Bounds the set if a user opens save dialogs repeatedly without ever writing. */
const MAX_PENDING_SAVE_TARGETS = 32;

function normalisePath(candidate: string): string {
    const resolved = path.resolve(candidate);
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

/** Record a path the user just chose in the main-process save dialog. */
export function recordApprovedSaveTarget(filePath: string): void {
    if (typeof filePath !== 'string' || !filePath.trim()) return;
    if (pendingSaveTargets.size >= MAX_PENDING_SAVE_TARGETS) {
        const oldest = pendingSaveTargets.values().next().value;
        if (oldest !== undefined) pendingSaveTargets.delete(oldest);
    }
    pendingSaveTargets.add(normalisePath(filePath));
}

/**
 * Consume the approval for a write. Returns false when the renderer supplied a path the
 * user never approved in this session (or one already written once).
 */
export function consumeApprovedSaveTarget(raw: unknown): boolean {
    if (typeof raw !== 'string' || !raw.trim()) return false;
    const key = normalisePath(raw);
    return pendingSaveTargets.delete(key);
}

// ========================================
// shell:open-path (reveal a folder)
// ========================================

export type OpenPathCheck = { ok: true; path: string } | { ok: false; error: string };

/** Directories the app owns outright; no dialog approval needed to reveal these. */
function getAppOwnedRoots(): string[] {
    return [
        app.getPath('userData'),
        path.join(app.getPath('documents'), 'WhatNext'),
    ];
}

/** Resolve symlinks so containment is checked against the real location. */
async function realpathOrResolve(candidate: string): Promise<string> {
    try {
        return await fs.promises.realpath(candidate);
    } catch {
        return path.resolve(candidate);
    }
}

/**
 * Validate a `shell:open-path` request.
 *
 * Two teeth here: `shell.openPath` on a *file* launches it with the OS default handler
 * (execution, for `.desktop`/`.bat`/`.exe`), so files are refused outright; and the
 * directory must be one the app owns or one the user picked in a main-process dialog.
 */
export async function validateOpenPathRequest(raw: unknown): Promise<OpenPathCheck> {
    if (typeof raw !== 'string' || !raw.trim() || raw.includes('\0')) {
        return { ok: false, error: 'Invalid path' };
    }
    if (!path.isAbsolute(raw)) {
        return { ok: false, error: 'Invalid path' };
    }

    const real = await realpathOrResolve(raw);

    let stats: fs.Stats;
    try {
        stats = await fs.promises.stat(real);
    } catch {
        return { ok: false, error: 'Directory not found' };
    }
    if (!stats.isDirectory()) {
        return { ok: false, error: 'Not a directory' };
    }

    const roots = [...getAppOwnedRoots(), ...getApprovedDirectories()];
    for (const root of roots) {
        const realRoot = await realpathOrResolve(root);
        if (isPathContained(real, realRoot)) {
            return { ok: true, path: real };
        }
    }

    return { ok: false, error: 'Directory not permitted' };
}
