/**
 * Last-Write-Wins (LWW) conflict resolution helpers.
 *
 * Extracted from replication-handler.ts (#42) so the comparison logic is pure,
 * unit-testable, and skew-aware. The previous implementation compared the raw
 * `updatedAt` STRINGS with `>`, which only sorts correctly for ISO-8601 values
 * that share identical format, timezone, and fractional-second precision. Any
 * drift (a missing `Z`, different precision, a non-ISO source) silently
 * corrupted the merge. These helpers parse timestamps to epoch milliseconds
 * before comparing and define a deterministic tie-break so two peers converge
 * on the SAME winner.
 *
 * Clock-skew posture: LWW fundamentally trusts wall clocks. We do NOT clamp
 * implausibly-future timestamps in the MVP — a peer with a fast clock can win
 * conflicts it should not. This is an accepted limitation of LWW; the migration
 * path is CRDTs (Phase 2). See [[RxDB-Replication]] "Conflict Resolution".
 */

import { DEVICE_LOCAL_FIELDS } from './schemas';

/**
 * Parse a timestamp value into epoch milliseconds.
 *
 * Accepts ISO-8601 strings (any precision/timezone that `Date.parse` handles)
 * and numeric epoch-ms values. Anything missing, empty, or unparseable maps to
 * `0` (treated as the oldest possible time) rather than throwing — an
 * unparseable timestamp must never crash replication, and "oldest" is the safe
 * default because it loses to any real timestamp.
 */
export function parseTimestampMs(value: unknown): number {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }
    if (typeof value !== 'string') {
        return 0;
    }
    const trimmed = value.trim();
    if (trimmed === '') {
        return 0;
    }
    const ms = Date.parse(trimmed);
    return Number.isNaN(ms) ? 0 : ms;
}

/**
 * A candidate document version for LWW comparison.
 *
 * `updatedAt` is the primary clock; `addedAt` is a fallback for documents that
 * predate the `updatedAt` field. `tiebreak` is a deterministic, content-derived
 * string used ONLY when two versions carry the exact same timestamp — it must be
 * computed identically on every peer (see {@link stableStringify}) so the merge
 * converges instead of ping-ponging.
 */
export interface LwwCandidate {
    updatedAt?: unknown;
    addedAt?: unknown;
    tiebreak?: string;
}

/**
 * Resolve the effective epoch-ms for a candidate: prefer `updatedAt`, fall back
 * to `addedAt` only when `updatedAt` is missing/unparseable (resolves to 0).
 */
export function resolveTimestampMs(candidate: LwwCandidate): number {
    const primary = parseTimestampMs(candidate.updatedAt);
    if (primary > 0) {
        return primary;
    }
    return parseTimestampMs(candidate.addedAt);
}

/**
 * Decide whether the incoming version should overwrite the existing one.
 *
 * Rules (deterministic and identical on both peers):
 *  1. Compare parsed epoch-ms. The strictly-later timestamp wins.
 *  2. On an exact tie, compare the deterministic `tiebreak` content key
 *     lexicographically; the larger key wins.
 *  3. If timestamps AND tiebreak keys are equal, the versions are
 *     indistinguishable — keep the existing one (no write).
 */
export function incomingWins(incoming: LwwCandidate, existing: LwwCandidate): boolean {
    const incomingMs = resolveTimestampMs(incoming);
    const existingMs = resolveTimestampMs(existing);

    if (incomingMs !== existingMs) {
        return incomingMs > existingMs;
    }

    const incomingKey = incoming.tiebreak ?? '';
    const existingKey = existing.tiebreak ?? '';
    if (incomingKey === existingKey) {
        return false;
    }
    return incomingKey > existingKey;
}

/**
 * Derive the deterministic equal-timestamp tie-break key for a document version.
 *
 * CRITICAL for cross-peer convergence: both peers must compute the SAME key for
 * the SAME logical content. The incoming side carries a transmitted `data`
 * payload while the existing side is a full `RxDocument.toJSON()`. Those two
 * shapes differ in exactly the fields the replication envelope pulls out or RxDB
 * manages — never in user content — so comparing them raw would be
 * apples-to-oranges and could make two peers pick DIFFERENT winners on a tie
 * (divergence). We therefore project both sides down to the same canonical user
 * content by dropping {@link NON_CONTENT_KEYS}:
 *  - `id` — pulled out of `data` (`{id, data, updatedAt}`) and identical across
 *    the two competing versions anyway;
 *  - `updatedAt` / `addedAt` — the LWW clocks, pulled out of `data`; at a tie
 *    `updatedAt` is equal by definition and `addedAt` is the doc's creation time
 *    (equal across versions of the same id) — neither discriminates;
 *  - any `_`-prefixed field — RxDB internals (`_rev`, `_meta`, `_attachments`,
 *    `_deleted`) that never cross the wire;
 *  - any {@link DEVICE_LOCAL_FIELDS} (`localFilePath`, `localFileSize`,
 *    `albumArtLocalPath`, `coverArtLocalPath`) — the SENDER strips these from the
 *    transmitted `data`, but they SURVIVE on the receiver's `existing.toJSON()`.
 *    Excluding them here keeps the receiver's existing-side key over the SAME
 *    field set the incoming side already lacks; otherwise the existing-side key
 *    would carry e.g. `localFilePath` (sorting before `name`) and the two peers
 *    would elect opposite winners on a tie — an oscillating divergence.
 * Every dropped key is non-discriminating at a tie and removed identically from
 * both sides, so `contentKey(incoming.data)` and `contentKey(existing.toJSON())`
 * reduce to the same string for the same user content — symmetric and
 * convergent. (Residual assumption: the transmitted `data` carries the same user
 * fields the stored doc does, which must hold for replication to work at all.)
 */
const NON_CONTENT_KEYS = new Set<string>([
    'id',
    'updatedAt',
    'addedAt',
    ...DEVICE_LOCAL_FIELDS,
]);

export function contentKey(value: unknown): string {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return stableStringify(value);
    }
    const projected: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        if (NON_CONTENT_KEYS.has(k) || k.startsWith('_')) {
            continue;
        }
        projected[k] = v;
    }
    return stableStringify(projected);
}

/**
 * Deterministically serialize a value to a string with object keys sorted, so
 * two peers produce byte-identical output for equal content. Used to derive the
 * equal-timestamp tie-break key. Not a hash — collisions are irrelevant here
 * because identical keys simply mean "keep existing".
 */
export function stableStringify(value: unknown): string {
    return JSON.stringify(value, (_key, val) => {
        if (val && typeof val === 'object' && !Array.isArray(val)) {
            return Object.keys(val as Record<string, unknown>)
                .sort()
                .reduce<Record<string, unknown>>((acc, k) => {
                    acc[k] = (val as Record<string, unknown>)[k];
                    return acc;
                }, {});
        }
        return val;
    });
}
