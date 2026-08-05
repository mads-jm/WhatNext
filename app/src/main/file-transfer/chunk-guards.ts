/**
 * Inbound chunk guards — the trust boundary for peer-supplied file bytes.
 *
 * A remote peer is untrusted in exactly the way the renderer is (CLAUDE.md
 * constraint #4). Before this module existed, `handleChunkReceived` created and
 * wrote `.partial/{sha256}.tmp` at the peer-supplied `offset` and only *afterwards*
 * looked up `activeTransfers` — so any connected peer could create unlimited temp
 * files and write at arbitrary offsets (remote disk-fill).
 *
 * Everything here is pure: it takes the chunk payload plus the transfer record we
 * already hold (or `undefined`) and returns a verdict. No fs, no Electron, no
 * module state — so each rule is unit-testable on its own, in the shape
 * `ipc-guards.ts` / `downloader-guards.ts` established for the renderer boundary.
 *
 * Two rejection actions, and the difference matters:
 *   - `drop`  — the chunk is not ours to write, but the *transfer* (if any) is fine.
 *               Never fail a transfer on this: a hostile third peer could otherwise
 *               kill our downloads just by spraying chunks at us.
 *   - `fail`  — the chunk came from the peer we asked, on a transfer we opened, and
 *               it violates what that peer itself declared. The partial is discarded.
 */

import type { ActiveTransfer } from '../../shared/core/file-transfer-types'
import { isValidSha256 } from '../utils/path-safety'

/** Statuses for which we are still willing to accept bytes. */
const ACCEPTING_STATUSES: ReadonlySet<ActiveTransfer['status']> = new Set([
    'pending',
    'transferring',
])

export interface InboundChunk {
    peerId: string
    sha256: string
    offset: number
    /** base64-encoded chunk body (JSON transport) */
    data: string
}

export type ChunkVerdict =
    | {
          ok: true
          /** Decoded bytes to write at `offset`. */
          chunk: Buffer
          /** New high-water mark for `transfer.bytesReceived`, never above `totalBytes`. */
          bytesReceived: number
      }
    | { ok: false; action: 'drop' | 'fail'; reason: string }

/**
 * Decide whether a chunk that arrived from the P2P layer may touch the disk.
 *
 * @param payload  - The chunk as the utility process forwarded it.
 * @param transfer - Our record for `payload.sha256`, or `undefined` if we have none.
 */
export function evaluateInboundChunk(
    payload: InboundChunk,
    transfer: ActiveTransfer | undefined,
): ChunkVerdict {
    const { peerId, sha256, offset, data } = payload

    // Cheap, allocation-free checks first — a chunk we never asked for must not be
    // able to make us decode a multi-megabyte base64 body.
    if (!isValidSha256(sha256)) {
        return { ok: false, action: 'drop', reason: 'invalid sha256 format' }
    }

    if (!transfer) {
        return { ok: false, action: 'drop', reason: 'no transfer was requested for this hash' }
    }

    if (!ACCEPTING_STATUSES.has(transfer.status)) {
        return {
            ok: false,
            action: 'drop',
            reason: `transfer is not accepting bytes (status: ${transfer.status})`,
        }
    }

    if (peerId !== transfer.peerId) {
        // A second peer cannot inject bytes into a transfer we opened with someone else.
        return {
            ok: false,
            action: 'drop',
            reason: `chunk came from ${peerId} but the transfer belongs to ${transfer.peerId}`,
        }
    }

    // From here on the sender *is* the peer we asked, so a malformed chunk is that
    // peer overstepping what it declared — fail the transfer rather than silently
    // accumulating a corrupt partial.
    if (!Number.isSafeInteger(offset) || offset < 0) {
        return { ok: false, action: 'fail', reason: `invalid chunk offset: ${String(offset)}` }
    }

    if (typeof data !== 'string') {
        return { ok: false, action: 'fail', reason: 'chunk data is not a string' }
    }

    const chunk = Buffer.from(data, 'base64')

    if (offset + chunk.length > transfer.totalBytes) {
        return {
            ok: false,
            action: 'fail',
            reason:
                `chunk exceeds declared size: offset ${offset} + ${chunk.length} bytes ` +
                `> totalBytes ${transfer.totalBytes}`,
        }
    }

    // High-water mark, not "last write wins": duplicate and overlapping chunks must
    // never push the counter backwards, and the bound above keeps it <= totalBytes.
    const bytesReceived = Math.max(transfer.bytesReceived, offset + chunk.length)

    return { ok: true, chunk, bytesReceived }
}
