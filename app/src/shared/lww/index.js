/**
 * Shared Last-Write-Wins (LWW) core.
 *
 * SINGLE SOURCE OF TRUTH for LWW conflict resolution, imported by BOTH:
 *  - the app (TypeScript) via `app/src/renderer/db/lww.ts` and
 *    `app/src/renderer/db/schemas.ts`, and
 *  - the test peer (plain Node ESM) via `test-peer/src/session-store.js`.
 *
 * Sharing rather than copying is deliberate (#58). The counter-example is
 * `test-peer/src/p2p-config.js`, a hand-maintained copy carrying "Keep this in
 * sync with the TypeScript version!" — exactly the drift that made the test peer
 * resolve conflicts with pre-#54 semantics while the app used post-#54 ones.
 *
 * Why JavaScript and not TypeScript: the test peer runs `node src/index.js` with
 * no build step, so it can only import runtime-loadable JS. The sibling
 * `package.json` pins `"type": "module"` because `app/package.json` declares
 * `"type": "commonjs"` and Node resolves a file's module system from the NEAREST
 * package.json — without it Node would load this file as CommonJS and reject
 * `export`. The app keeps full types through JSDoc (tsconfig has `allowJs`), so
 * no `.d.ts` sidecar is required.
 *
 * ── Semantics (unchanged from the TypeScript original, #42) ──
 * The pre-#42 implementation compared the raw `updatedAt` STRINGS with `>`,
 * which only sorts correctly for ISO-8601 values that share identical format,
 * timezone, and fractional-second precision. Any drift (a missing `Z`, different
 * precision, a non-ISO source) silently corrupted the merge. These helpers parse
 * timestamps to epoch milliseconds before comparing and define a deterministic
 * tie-break so two peers converge on the SAME winner.
 *
 * Clock-skew posture: LWW fundamentally trusts wall clocks. We do NOT clamp
 * implausibly-future timestamps in the MVP — a peer with a fast clock can win
 * conflicts it should not. This is an accepted limitation of LWW; the migration
 * path is CRDTs (Phase 2). See [[RxDB-Replication]] "Conflict Resolution".
 */

/**
 * Fields that describe a document's state on THIS device only (cached file
 * locations/sizes) and are meaningless to other peers. They are stripped before
 * a document is transmitted (see useSessionReplication push) and MUST also be
 * excluded from the LWW equal-timestamp content tie-break key (see contentKey)
 * so both peers compute the key over the identical field set and converge on the
 * same winner. This is the single source of truth so the sender-strip and the
 * tiebreak-strip cannot drift apart — on either side of the wire.
 *
 * @type {readonly string[]}
 */
export const DEVICE_LOCAL_FIELDS = [
    'localFilePath',
    'localFileSize',
    'albumArtLocalPath',
    'coverArtLocalPath',
];

/**
 * Parse a timestamp value into epoch milliseconds.
 *
 * Accepts ISO-8601 strings (any precision/timezone that `Date.parse` handles)
 * and numeric epoch-ms values. Anything missing, empty, or unparseable maps to
 * `0` (treated as the oldest possible time) rather than throwing — an
 * unparseable timestamp must never crash replication, and "oldest" is the safe
 * default because it loses to any real timestamp.
 *
 * @param {unknown} value
 * @returns {number}
 */
export function parseTimestampMs(value) {
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
 *
 * @typedef {object} LwwCandidate
 * @property {unknown} [updatedAt]
 * @property {unknown} [addedAt]
 * @property {string} [tiebreak]
 */

/**
 * Resolve the effective epoch-ms for a candidate: prefer `updatedAt`, fall back
 * to `addedAt` only when `updatedAt` is missing/unparseable (resolves to 0).
 *
 * @param {LwwCandidate} candidate
 * @returns {number}
 */
export function resolveTimestampMs(candidate) {
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
 *
 * @param {LwwCandidate} incoming
 * @param {LwwCandidate} existing
 * @returns {boolean}
 */
export function incomingWins(incoming, existing) {
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
 * Keys dropped before deriving the equal-timestamp tie-break key.
 *
 * CRITICAL for cross-peer convergence: both peers must compute the SAME key for
 * the SAME logical content. The incoming side carries a transmitted `data`
 * payload while the existing side is a full `RxDocument.toJSON()` (app) or a
 * previously-received envelope's `data` (test peer). Those shapes differ in
 * exactly the fields the replication envelope pulls out or RxDB manages — never
 * in user content — so comparing them raw would be apples-to-oranges and could
 * make two peers pick DIFFERENT winners on a tie (divergence). We therefore
 * project both sides down to the same canonical user content by dropping:
 *  - `id` — pulled out of `data` (`{id, data, updatedAt}`) and identical across
 *    the two competing versions anyway;
 *  - `updatedAt` / `addedAt` — the LWW clocks, pulled out of `data`; at a tie
 *    `updatedAt` is equal by definition and `addedAt` is the doc's creation time
 *    (equal across versions of the same id) — neither discriminates;
 *  - any `_`-prefixed field — RxDB internals (`_rev`, `_meta`, `_attachments`,
 *    `_deleted`) that never cross the wire;
 *  - any {@link DEVICE_LOCAL_FIELDS} (`localFilePath`, `localFileSize`,
 *    `albumArtLocalPath`, `coverArtLocalPath`) — the SENDER strips these from the
 *    transmitted `data`, but they SURVIVE on the receiver's stored copy.
 *    Excluding them here keeps the receiver's existing-side key over the SAME
 *    field set the incoming side already lacks; otherwise the existing-side key
 *    would carry e.g. `localFilePath` (sorting before `name`) and the two peers
 *    would elect opposite winners on a tie — an oscillating divergence.
 * Every dropped key is non-discriminating at a tie and removed identically from
 * both sides, so `contentKey(incoming.data)` and `contentKey(existing)` reduce to
 * the same string for the same user content — symmetric and convergent.
 * (Residual assumption: the transmitted `data` carries the same user fields the
 * stored doc does, which must hold for replication to work at all.)
 *
 * @type {Set<string>}
 */
const NON_CONTENT_KEYS = new Set([
    'id',
    'updatedAt',
    'addedAt',
    ...DEVICE_LOCAL_FIELDS,
]);

/**
 * Derive the deterministic equal-timestamp tie-break key for a document version.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function contentKey(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return stableStringify(value);
    }
    /** @type {Record<string, unknown>} */
    const projected = {};
    for (const [k, v] of Object.entries(/** @type {Record<string, unknown>} */ (value))) {
        if (NON_CONTENT_KEYS.has(k) || k.startsWith('_')) {
            continue;
        }
        projected[k] = v;
    }
    return stableStringify(projected);
}

/**
 * Project a replication ENVELOPE (`{id, data, updatedAt, deleted?}` — the shape
 * that crosses the wire) onto an {@link LwwCandidate}.
 *
 * Shared rather than written out at each call site because this projection is
 * half of what makes two peers converge: it decides which clock is read and what
 * the tie-break key is computed over. The app uses it for the INCOMING side of a
 * merge; the test peer uses it for BOTH sides, since everything it stores is an
 * envelope. A verbatim extraction of the app's previous inline literal — no
 * semantic change (#58 ports the app's semantics to the test peer; it does not
 * alter them on either side).
 *
 * Note there is no `addedAt` fallback here, matching the app's incoming side:
 * an envelope that reached us always carries `updatedAt`, so the fallback would
 * be unreachable, and adding it would change app behaviour for malformed input.
 *
 * @param {{data?: unknown, updatedAt?: unknown}} envelope
 * @returns {LwwCandidate}
 */
export function envelopeCandidate(envelope) {
    return {
        updatedAt: envelope?.updatedAt,
        tiebreak: contentKey(envelope?.data),
    };
}

/**
 * Project a STORED document body (a full `RxDocument.toJSON()`) onto an
 * {@link LwwCandidate}. Used by the app for the EXISTING side of a merge.
 *
 * Unlike {@link envelopeCandidate} the clocks live on the document itself, and
 * `addedAt` is a fallback for documents written before `updatedAt` existed. A
 * verbatim extraction of the app's previous inline literal.
 *
 * @param {Record<string, unknown>} stored
 * @returns {LwwCandidate}
 */
export function storedCandidate(stored) {
    return {
        updatedAt: stored?.updatedAt,
        addedAt: stored?.addedAt,
        tiebreak: contentKey(stored),
    };
}

/**
 * Deterministically serialize a value to a string with object keys sorted, so
 * two peers produce byte-identical output for equal content. Used to derive the
 * equal-timestamp tie-break key. Not a hash — collisions are irrelevant here
 * because identical keys simply mean "keep existing".
 *
 * @param {unknown} value
 * @returns {string}
 */
export function stableStringify(value) {
    return JSON.stringify(value, (_key, val) => {
        if (val && typeof val === 'object' && !Array.isArray(val)) {
            return Object.keys(/** @type {Record<string, unknown>} */ (val))
                .sort()
                .reduce((acc, k) => {
                    acc[k] = /** @type {Record<string, unknown>} */ (val)[k];
                    return acc;
                }, /** @type {Record<string, unknown>} */ ({}));
        }
        return val;
    });
}
