/**
 * Downloader IPC guards — the trust boundary for renderer strings that become *argv*
 * for a spawned downloader binary.
 *
 * `spawn` is shell-free, so there is no shell metacharacter problem here. The problem
 * is the downloaders' own argument parsers: yt-dlp and spotDL read a leading-dash
 * positional as an *option*, so a renderer-supplied "URL" of `--exec=<cmd>` is
 * arbitrary command execution, and `-o`/`--config-location` are arbitrary file writes.
 * Three entry points feed that argv:
 *
 *   - `download:resolve`          → `backend.resolve(input)`   (url, or spotify ids)
 *   - `download:start`            → `backend.download(tracks)` (each `sourceUrl`)
 *   - `download:set-backend-path` → which executable we spawn at all
 *
 * Each gets one exported check here — importable and testable on its own, in the
 * shape `ipc-guards.ts` established for `main.ts` (cycle 1). Nothing in this module
 * touches Electron directly; the one main-process capability the backend-path check
 * needs (a native confirmation dialog) is injected by the caller.
 *
 * Authority model for `set-backend-path` (the extension of the cycle-1 doctrine):
 * a path the user picked in a main-process file dialog is trusted outright, because
 * main itself recorded what the dialog returned. A hand-typed path is *also* allowed —
 * sovereignty (CLAUDE.md #1) means you can always point WhatNext at your own binary —
 * but it must exist as a regular file and the user must confirm it in a native prompt
 * before anything is persisted or spawned.
 */

import * as fs from 'fs';
import * as path from 'path';
import { wasApprovedOpenFile } from '../ipc-guards';
import type { DownloaderBackendId } from '../../shared/core/ipc-protocol';

/** Thrown at the IPC boundary when renderer input would reach a downloader's argv. */
export class DownloadInputError extends Error {
    constructor(message: string) {
        super(`Download rejected: ${message}`);
        this.name = 'DownloadInputError';
    }
}

// ========================================
// URL / id shape checks
// ========================================

/** Longer than any legitimate media link; bounds the work done below. */
const MAX_URL_LENGTH = 2048;

/** C0/C1 control characters — never valid in a URL we hand to a subprocess. */
// Justification: this pattern's whole job is to detect control characters, so
// the rule can only ever be wrong here. Already written with \u escapes, which
// does not satisfy it either.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/;

/**
 * Protocols a downloader may be pointed at. Deliberately narrower than
 * `validateExternalUrl` in `ipc-guards.ts`, which also permits custom app URIs like
 * `spotify:` — those are for the OS URL handler, not for argv.
 */
const DOWNLOAD_PROTOCOLS = ['http:', 'https:'];

/** Spotify ids are 22-character base62. `spotdl-backend` interpolates them into a URL. */
const SPOTIFY_ID_PATTERN = /^[A-Za-z0-9]{22}$/;

export type UrlCheck = { ok: true; url: string } | { ok: false; error: string };

/**
 * Validate a single source URL.
 *
 * Returns the caller's original string on success rather than `URL.href`: the renderer
 * correlates progress/error events by the exact `sourceUrl` it sent, so normalising it
 * here would silently orphan every event for that track.
 */
export function validateSourceUrl(raw: unknown): UrlCheck {
    if (typeof raw !== 'string' || raw.length === 0) {
        return { ok: false, error: 'a source URL is missing' };
    }
    if (raw.length > MAX_URL_LENGTH) {
        return { ok: false, error: 'the source URL is too long' };
    }
    if (CONTROL_CHARS.test(raw)) {
        return { ok: false, error: `"${raw}" contains control characters` };
    }

    let parsed: URL;
    try {
        parsed = new URL(raw);
    } catch {
        return { ok: false, error: `"${raw}" is not a valid URL` };
    }
    if (!DOWNLOAD_PROTOCOLS.includes(parsed.protocol)) {
        return { ok: false, error: `"${raw}" is not an http(s) URL` };
    }
    return { ok: true, url: raw };
}

export type ResolveInputCheck = { ok: true } | { ok: false; error: string };

/**
 * Validate a `download:resolve` input. Both branches of the union are live:
 * `url` (the paste-a-link flow) and `spotify-ids` (the library download flow, which
 * `SpotdlBackend` turns into `https://open.spotify.com/track/<id>` before spawning).
 */
export function validateResolveInput(raw: unknown): ResolveInputCheck {
    if (typeof raw !== 'object' || raw === null) {
        return { ok: false, error: 'no input was supplied' };
    }
    const input = raw as { type?: unknown; url?: unknown; spotifyIds?: unknown };

    if (input.type === 'url') {
        const check = validateSourceUrl(input.url);
        return check.ok ? { ok: true } : check;
    }

    if (input.type === 'spotify-ids') {
        if (!Array.isArray(input.spotifyIds) || input.spotifyIds.length === 0) {
            return { ok: false, error: 'no Spotify track ids were supplied' };
        }
        for (const id of input.spotifyIds) {
            if (typeof id !== 'string' || !SPOTIFY_ID_PATTERN.test(id)) {
                return { ok: false, error: `"${String(id)}" is not a Spotify track id` };
            }
        }
        return { ok: true };
    }

    return { ok: false, error: `unsupported input type "${String(input.type)}"` };
}

// ========================================
// download:set-backend-path
// ========================================

/**
 * Local copy of the backend id list. `downloader-config-store` has its own; importing
 * it here would drag Electron's `app` into this module for three string literals.
 */
const BACKEND_IDS: readonly DownloaderBackendId[] = ['ytdlp', 'spotdl', 'spytify'];

export type BackendPathDecision =
    | { ok: true; id: DownloaderBackendId; path: string | null }
    | { ok: false; reason: 'invalid'; error: string }
    | { ok: false; reason: 'declined' };

/** Asks the user, in a *main-process* dialog, to confirm spawning this executable. */
export type ConfirmExecutable = (executablePath: string) => Promise<boolean>;

/**
 * Validate a `download:set-backend-path` request.
 *
 * Nothing here persists or spawns anything — the caller does that only on `ok: true`,
 * so a declined confirmation leaves the previous setting exactly as it was.
 *
 * `confirm` is only reached on the accept path: a path that fails the `stat` never
 * raises a modal, and clearing a path (`null`) never prompts at all, because dropping
 * a custom binary reduces privilege.
 */
export async function validateBackendPathRequest(
    raw: unknown,
    confirm: ConfirmExecutable,
): Promise<BackendPathDecision> {
    if (typeof raw !== 'object' || raw === null) {
        return { ok: false, reason: 'invalid', error: 'Malformed request' };
    }
    const payload = raw as { id?: unknown; path?: unknown };

    const id = payload.id;
    if (typeof id !== 'string' || !(BACKEND_IDS as readonly string[]).includes(id)) {
        return { ok: false, reason: 'invalid', error: `Unknown download backend: "${String(id)}"` };
    }
    const backendId = id as DownloaderBackendId;

    // Clearing: no prompt, no checks beyond the id — this only removes a custom path.
    if (payload.path === null || payload.path === undefined) {
        return { ok: true, id: backendId, path: null };
    }
    if (typeof payload.path !== 'string') {
        return { ok: false, reason: 'invalid', error: 'Path must be a string' };
    }
    const candidate = payload.path.trim();
    if (!candidate) {
        return { ok: true, id: backendId, path: null };
    }

    if (candidate.includes('\0')) {
        return { ok: false, reason: 'invalid', error: 'Path contains an invalid character' };
    }
    if (!path.isAbsolute(candidate)) {
        return {
            ok: false,
            reason: 'invalid',
            error: 'Enter the full path to the program (leave blank to use PATH)',
        };
    }

    const resolved = path.resolve(candidate);

    // `stat` follows symlinks on purpose: a symlinked binary (pipx, homebrew, /usr/bin
    // alternatives) is a normal install shape, and the target is what actually runs.
    let stats: fs.Stats;
    try {
        stats = await fs.promises.stat(resolved);
    } catch {
        return { ok: false, reason: 'invalid', error: `No such file: ${resolved}` };
    }
    if (!stats.isFile()) {
        return { ok: false, reason: 'invalid', error: `Not a program file: ${resolved}` };
    }

    // The only thing that skips the prompt is main's own record of what a file dialog
    // returned. A renderer claim to that effect (an extra payload field, say) is not
    // consulted anywhere in this function, and cannot be.
    if (wasApprovedOpenFile(resolved)) {
        return { ok: true, id: backendId, path: resolved };
    }

    const confirmed = await confirm(resolved);
    if (!confirmed) {
        return { ok: false, reason: 'declined' };
    }
    return { ok: true, id: backendId, path: resolved };
}
