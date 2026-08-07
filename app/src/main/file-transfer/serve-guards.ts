/**
 * Serve-path authorization — the trust boundary for files leaving this machine.
 *
 * Manifests have always been deny-by-default, but `handleIncomingRequest` used to
 * serve any sha256 present in the hash cache. That cache is persistent and holds
 * every file this install has ever hashed *plus* every file a peer ever sent us,
 * so the authorization model degenerated to "knows the file's hash" — and knowing
 * a hash is not consent (CLAUDE.md constraint #1: the user's explicit intent
 * governs what leaves their machine).
 *
 * The rule here is consent *per exchange* (user ruling 2026-08-05, option B): a
 * hash is servable because we handed it to a peer in a manifest while sharing was
 * enabled, not because it happens to sit in the cache. Turning sharing off
 * withdraws what that playlist's manifest published.
 *
 * Two accepted consequences, both documented in
 * `WhatNext - docs/08 specs/epic-file-transfer-guards.md`:
 *   - The registry is in-memory, like `sharingState` itself. After an app restart
 *     nothing is servable until the host re-enables sharing *and* a peer re-fetches
 *     a manifest — and nothing in the renderer re-fetches manifests on reconnect
 *     today. Fail-closed is the accepted MVP behavior, not a defect.
 *   - Revocation applies to requests arriving after the toggle. An in-flight serve
 *     is not aborted; see `handleIncomingRequest`.
 *
 * `evaluateServeRequest` is pure and the registry is a plain class — no fs, no
 * Electron, no module state — so both are unit-testable on their own, in the shape
 * `ipc-guards.ts` / `downloader-guards.ts` / `chunk-guards.ts` established.
 */

import type { FileEntry } from '../../shared/core/file-transfer-types';

/**
 * The hashes we have published in manifests, per playlist.
 *
 * Kept per playlist rather than as one flat set so that disabling sharing for one
 * playlist cannot withdraw a hash another shared playlist also published (the same
 * file can appear in several playlists).
 */
export class ServedHashRegistry {
    private readonly byPlaylist = new Map<string, Set<string>>();

    /**
     * Record everything a manifest we just handed to a peer contains.
     *
     * Takes the manifest's own `FileEntry[]` rather than a caller-built hash list:
     * every entry type (audio, artwork, cover-art) is then allowlisted by
     * construction, with no per-type branch here to forget to update.
     *
     * Replaces — does not merge with — the previous manifest for this playlist, so
     * a file dropped from the playlist stops being servable once a fresh manifest
     * has gone out.
     */
    record(playlistId: string, files: readonly FileEntry[]): void {
        this.byPlaylist.set(playlistId, new Set(files.map((f) => f.sha256)));
    }

    /** Withdraw everything this playlist's manifests published (sharing turned off). */
    revoke(playlistId: string): void {
        this.byPlaylist.delete(playlistId);
    }

    /** True when some sharing-enabled playlist has published this hash to a peer. */
    isServable(sha256: string): boolean {
        for (const hashes of this.byPlaylist.values()) {
            if (hashes.has(sha256)) return true;
        }
        return false;
    }
}

export type ServeVerdict =
    { ok: true; filePath: string } | { ok: false; reason: string };

/**
 * Decide whether a peer's `file-request` may be answered with bytes.
 *
 * Both rules are in-memory lookups: the decision is made before any `stat`, any
 * `createReadStream`, and any `file-header` reaching the wire.
 *
 * The `reason` is for our own logs only. Callers must answer *every* rejection
 * with the identical not-found response, or refusals become an oracle for
 * enumerating what the user holds.
 *
 * @param sha256     - The hash the peer asked for.
 * @param registry   - What we have published under active sharing.
 * @param lookupPath - Hash-cache lookup; returns null when we hold no such file.
 */
export function evaluateServeRequest(
    sha256: string,
    registry: ServedHashRegistry,
    lookupPath: (sha256: string) => string | null,
): ServeVerdict {
    if (!registry.isServable(sha256)) {
        return {
            ok: false,
            reason: 'hash was not published in a manifest under active sharing',
        };
    }

    const filePath = lookupPath(sha256);
    if (!filePath) {
        return { ok: false, reason: 'no local file for this hash' };
    }

    return { ok: true, filePath };
}
