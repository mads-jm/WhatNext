/**
 * Last-Write-Wins (LWW) conflict resolution helpers — app-facing barrel.
 *
 * The implementation lives in `app/src/shared/lww/index.js` and is imported
 * verbatim by BOTH the app and the test peer (#58). This file exists so the
 * app's existing `./lww` import path and its exported surface stay unchanged;
 * see the shared module for the semantics, the clock-skew posture, and why the
 * shared source is plain JavaScript.
 */

export {
    DEVICE_LOCAL_FIELDS,
    parseTimestampMs,
    resolveTimestampMs,
    incomingWins,
    contentKey,
    envelopeCandidate,
    storedCandidate,
    stableStringify,
} from '../../shared/lww/index.js';

export type { LwwCandidate } from '../../shared/lww/index.js';
