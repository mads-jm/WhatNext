/**
 * File Transfer IPC — Main Process
 *
 * Bridges between:
 *   Renderer  ←→  Main  ←→  Utility Process (P2P layer)
 *
 * Responsibilities:
 *   - Serve files to peers (read from disk, stream chunks to utility)
 *   - Receive files from peers (write chunks to .partial/, verify + move on complete)
 *   - Forward manifest requests/responses
 *   - Track active transfer state for the renderer
 */

import { ipcMain, app } from 'electron'
import type { BrowserWindow, UtilityProcess } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import {
    IPC_CHANNELS,
    MainToUtilityMessageType,
    UtilityToMainMessageType,
    createIPCMessage,
    type IPCMessage,
} from '../../shared/core/ipc-protocol'
import type {
    FileEntry,
    ActiveTransfer,
    TransferProgress,
    TransferComplete,
    TransferError,
    FileManifest,
} from '../../shared/core/file-transfer-types'
import {
    FILE_TRANSFER_CONFIG,
} from '../../shared/core/file-transfer-types'
import { HashCache, computeFileSha256 } from './hash-cache'
import { buildManifest } from './manifest-builder'
import { evaluateInboundChunk } from './chunk-guards'
import { ServedHashRegistry, evaluateServeRequest } from './serve-guards'
// Filename sanitisation / containment helpers used to live here; they are now
// shared with the renderer-facing IPC guards. Behaviour is unchanged.
import { sanitizeFilename, isValidSha256, assertPathContained } from '../utils/path-safety'

// ========================================
// Module-level state
// ========================================

let hashCache: HashCache | null = null
let audioDir: string = ''
let artworkDir: string = ''
let partialDir: string = ''

/** Our own libp2p peer ID — set when NODE_STARTED fires in main.ts */
let ownPeerId: string = ''

/** playlistId → sharing enabled */
const sharingState = new Map<string, boolean>()

/**
 * What we may serve: the hashes our manifests published while sharing was enabled.
 * Sharing intent, not hash knowledge, authorizes a serve — see serve-guards.ts.
 */
const servedHashes = new ServedHashRegistry()

/** trackId → local file paths registered by the renderer */
const trackFileMap = new Map<string, { audioPath?: string; artworkPath?: string }>()

/** playlistId → cover art local path registered by the renderer */
const playlistCoverMap = new Map<string, string>()

/** playlistId → Set of trackIds registered by the renderer via register-tracks */
const playlistTrackMap = new Map<string, Set<string>>()

/** sha256 → ActiveTransfer (download state, peer → us) */
const activeTransfers = new Map<string, ActiveTransfer>()

/**
 * sha256 → the *promise* of the open file handle for that transfer's `.tmp`.
 *
 * A promise, not a handle: chunks are dispatched concurrently (`void
 * handleChunkReceived`), so two chunks for one sha256 both used to find the map
 * empty, both open a descriptor, and the second `set` orphaned the first — a leak
 * for the process's lifetime, and on Windows an open descriptor that can block the
 * rename in `handleTransferComplete`. Storing the in-flight open synchronously means
 * the second chunk awaits the first chunk's open instead of racing it.
 *
 * The map entry is also the transfer's *liveness token* for the receive path: it is
 * deleted synchronously by `closePartialHandle`, so anything awaiting an entry can
 * tell teardown ran under it by re-checking identity after its await.
 */
const partialHandles = new Map<string, Promise<fs.promises.FileHandle>>()

/** sha256 → bytes-per-second tracker */
const speedTrackers = new Map<string, { startMs: number; startBytes: number }>()

/** Debounce timer for persistTransferState — at most one write per second */
let persistTimer: NodeJS.Timeout | null = null

// ========================================
// Download queue (concurrency control)
// ========================================

/**
 * A download waiting for a concurrency slot.
 *
 * Only what dispatch and accounting need: fresh requests come from a `FileEntry`,
 * resumes come from an `ActiveTransfer`, and neither carries anything else the queue
 * uses — so the queue holds neither shape rather than making one masquerade as the other.
 */
interface QueuedDownload {
    peerId: string
    sha256: string
    type: FileEntry['type']
    offsetBytes: number
}

/** Pending download requests not yet dispatched to the utility process */
const downloadQueue: QueuedDownload[] = []

/** Number of audio transfers currently in-flight */
let activeAudioCount = 0

/** Number of artwork/cover-art transfers currently in-flight */
let activeArtworkCount = 0

/**
 * sha256 → which counter this transfer's in-flight slot was taken from.
 *
 * The counters used to be decremented from `transfer.type` by whichever of
 * complete/fail happened to run, so the same transfer could release twice (or
 * release a slot it never took — e.g. a transfer that failed while still queued).
 * `Math.max(0, …)` floored the counter but let real over-concurrency through.
 * Ownership lives here instead: a slot is recorded when `processQueue` dispatches
 * and released exactly once, by whoever gets there first.
 */
const slotHolders = new Map<string, 'audio' | 'artwork'>()

/**
 * Drop any not-yet-dispatched queue entries for a transfer that is no longer wanted.
 *
 * Without this, cancelling (or failing) a still-queued transfer leaves its request in
 * `downloadQueue`; `processQueue` would then dispatch it, take a slot, and never get
 * it back — the chunk guard drops the bytes for a cancelled/errored transfer, so no
 * complete/error ever arrives to release the slot.
 */
function removeQueuedRequests(sha256: string): void {
    for (let i = downloadQueue.length - 1; i >= 0; i--) {
        if (downloadQueue[i].sha256 === sha256) {
            downloadQueue.splice(i, 1)
        }
    }
}

/**
 * Release the concurrency slot held by a transfer, if it holds one.
 * Idempotent — the second and later calls for a sha256 are no-ops.
 */
function releaseSlot(sha256: string): void {
    const kind = slotHolders.get(sha256)
    if (!kind) return
    slotHolders.delete(sha256)
    if (kind === 'audio') {
        activeAudioCount = Math.max(0, activeAudioCount - 1)
    } else {
        activeArtworkCount = Math.max(0, activeArtworkCount - 1)
    }
}

// ========================================
// Queue processing
// ========================================

/**
 * Dispatch queued download requests up to the per-type concurrency limits.
 * Must be called after enqueuing a new item, and after a transfer completes or errors.
 */
function processQueue(): void {
    const utility = _utilityGetter?.()
    if (!utility) return

    let i = 0
    while (i < downloadQueue.length) {
        const item = downloadQueue[i]
        const isAudio = item.type === 'audio'

        if (isAudio) {
            if (activeAudioCount >= FILE_TRANSFER_CONFIG.MAX_CONCURRENT_AUDIO) {
                i++
                continue
            }
            activeAudioCount++
        } else {
            // artwork or cover-art
            if (activeArtworkCount >= FILE_TRANSFER_CONFIG.MAX_CONCURRENT_ARTWORK) {
                i++
                continue
            }
            activeArtworkCount++
        }

        downloadQueue.splice(i, 1)
        slotHolders.set(item.sha256, isAudio ? 'audio' : 'artwork')

        utility.postMessage(
            createIPCMessage(
                MainToUtilityMessageType.FILE_TRANSFER_REQUEST_FILE,
                { peerId: item.peerId, sha256: item.sha256, offsetBytes: item.offsetBytes },
            ),
        )
        // Don't increment i — the splice shifted the array
    }
}

// ========================================
// Init
// ========================================

async function ensureDirs(): Promise<void> {
    await fs.promises.mkdir(audioDir, { recursive: true })
    await fs.promises.mkdir(artworkDir, { recursive: true })
    await fs.promises.mkdir(partialDir, { recursive: true })
}

// ========================================
// Transfer state persistence
// ========================================

/**
 * Persist pending/transferring transfers to disk (debounced, max 1 write/sec).
 * Writes atomically: tmp file → rename.
 */
function persistTransferState(): void {
    if (persistTimer !== null) return
    persistTimer = setTimeout(() => {
        persistTimer = null
        void _doPersistTransferState()
    }, 1000)
}

async function _doPersistTransferState(): Promise<void> {
    if (!partialDir) return
    const statePath = path.join(partialDir, FILE_TRANSFER_CONFIG.TRANSFER_STATE_FILE)
    const tmpPath = `${statePath}.tmp`

    const toSave: ActiveTransfer[] = []
    for (const transfer of activeTransfers.values()) {
        if (transfer.status === 'pending' || transfer.status === 'transferring') {
            toSave.push(transfer)
        }
    }

    try {
        await fs.promises.mkdir(partialDir, { recursive: true })
        await fs.promises.writeFile(tmpPath, JSON.stringify(toSave, null, 2), 'utf8')
        await fs.promises.rename(tmpPath, statePath)
    } catch (err) {
        console.warn('[FileTransfer] Failed to persist transfer state:', err)
        // Clean up tmp on failure
        await fs.promises.unlink(tmpPath).catch(() => undefined)
    }
}

/**
 * Load persisted transfer state on startup.
 * Discards entries older than 24 hours.
 */
async function loadTransferState(): Promise<void> {
    const statePath = path.join(partialDir, FILE_TRANSFER_CONFIG.TRANSFER_STATE_FILE)
    try {
        const raw = await fs.promises.readFile(statePath, 'utf8')
        const entries = JSON.parse(raw) as ActiveTransfer[]
        const cutoff = Date.now() - 24 * 60 * 60 * 1000

        for (const entry of entries) {
            const age = new Date(entry.startedAt).getTime()
            if (Number.isNaN(age) || age < cutoff) {
                console.log('[FileTransfer] Discarding stale transfer (>24h):', entry.sha256)
                continue
            }
            activeTransfers.set(entry.sha256, entry)
        }
        console.log(`[FileTransfer] Loaded ${activeTransfers.size} transfer(s) from disk`)
    } catch (err: unknown) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
            console.warn('[FileTransfer] Could not parse transfers.json — starting fresh:', err)
        }
        // ENOENT is expected on first run; corrupted JSON falls through to empty state
    }
}

/**
 * Delete .tmp files in .partial/ that have no matching entry in activeTransfers.
 * Called once at startup after loadTransferState().
 */
async function cleanupStalePartials(): Promise<void> {
    let entries: string[]
    try {
        entries = await fs.promises.readdir(partialDir)
    } catch (err: unknown) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return
        console.warn('[FileTransfer] Could not read partial dir:', err)
        return
    }

    for (const entry of entries) {
        if (!entry.endsWith('.tmp')) continue
        const sha256 = entry.slice(0, -4) // strip ".tmp"
        if (!activeTransfers.has(sha256)) {
            const stale = path.join(partialDir, entry)
            try {
                await fs.promises.unlink(stale)
                console.log('[FileTransfer] Cleaned up orphan partial file:', entry)
            } catch (err) {
                console.warn('[FileTransfer] Could not delete stale partial:', entry, err)
            }
        }
    }
}

// ========================================
// Resume on peer reconnect
// ========================================

/**
 * Resume any pending/transferring transfers for the given peer.
 * Call this when a peer's handshake completes with file-transfer capability.
 *
 * Resumes are *queued*, not dispatched: they used to post FILE_TRANSFER_REQUEST_FILE
 * straight to the utility, so they never entered `slotHolders` and the
 * `MAX_CONCURRENT_*` limits simply did not apply to them — a peer reconnecting with
 * twenty incomplete audio files started all twenty at once, and a transfer still
 * sitting in `downloadQueue` was requested here *and* dispatched again by
 * `processQueue`, orphaning one of the two receive streams in the utility.
 *
 * Each resumable transfer is re-queued at the *front* (finish partials before starting
 * anything new) and its previous slot, if any, is released first so the re-dispatch
 * re-takes exactly one. See impl-notes for why a slot-holding transfer is re-requested
 * rather than skipped: a peer that vanishes mid-transfer is never reported to us (the
 * utility closes the receive stream silently on `peer:disconnect`), so resume is the
 * only path that can un-stick it, and skipping would hold its slot forever.
 */
export async function resumeIncompleteTransfers(peerId: string): Promise<void> {
    const utility = _utilityGetter?.()
    if (!utility) return

    const resumed: QueuedDownload[] = []

    for (const [sha256, transfer] of activeTransfers) {
        if (transfer.peerId !== peerId) continue
        if (transfer.status !== 'pending' && transfer.status !== 'transferring') continue

        const partialPath = path.join(partialDir, `${sha256}.tmp`)
        let offsetBytes = 0
        try {
            const stat = await fs.promises.stat(partialPath)
            offsetBytes = stat.size
        } catch {
            // Partial file gone — restart from zero
            offsetBytes = 0
            transfer.bytesReceived = 0
        }

        // Queued, not in flight: the status the renderer shows must match where the
        // transfer actually is, and it flips back to 'transferring' on the first chunk.
        transfer.status = 'pending'
        speedTrackers.set(sha256, { startMs: Date.now(), startBytes: offsetBytes })

        console.log(
            `[FileTransfer] Queueing resume of ${sha256} for peer ${peerId} at offset ${offsetBytes}`,
        )

        // Idempotence: whatever this transfer already had in the queue is dropped, and
        // whatever slot it already held is given back, so N handshakes for one peer
        // leave exactly one queue entry and at most one slot per transfer.
        removeQueuedRequests(sha256)
        releaseSlot(sha256)
        resumed.push({ peerId, sha256, type: transfer.type, offsetBytes })
    }

    // Unshift as a block so the resumed transfers keep their own relative order
    // while collectively jumping ahead of not-yet-dispatched fresh requests.
    if (resumed.length > 0) {
        downloadQueue.unshift(...resumed)
        processQueue()
        persistTransferState()
    }
}

// ========================================
// Exported setup function
// ========================================

/**
 * Register all file-transfer IPC handlers.
 * Must be called after mainWindow is created.
 *
 * @param win           - The main BrowserWindow (for renderer events)
 * @param utilityGetter - Returns the current UtilityProcess (may be null if not yet spawned)
 */
export async function registerFileTransferHandlers(
    win: BrowserWindow,
    utilityGetter: () => UtilityProcess | null,
): Promise<void> {
    // Resolve storage paths
    const docsDir = app.getPath('documents')
    audioDir = path.join(docsDir, 'WhatNext', 'audio')
    artworkDir = path.join(docsDir, 'WhatNext', 'artwork')
    partialDir = path.join(audioDir, FILE_TRANSFER_CONFIG.PARTIAL_DIR)

    await ensureDirs()

    hashCache = new HashCache(audioDir)
    await hashCache.init()

    // Load persisted transfer state and clean up orphaned partials
    await loadTransferState()
    await cleanupStalePartials()

    // ----------------------------------------------------------------
    // Renderer → Main IPC handlers
    // ----------------------------------------------------------------

    // file-transfer:request-manifest
    ipcMain.handle(
        IPC_CHANNELS.FILE_TRANSFER_REQUEST_MANIFEST,
        async (
            _e,
            { peerId, playlistId }: { peerId: string; playlistId: string },
        ) => {
            const utility = utilityGetter()
            if (!utility) {
                throw new Error('P2P utility process is not running')
            }
            utility.postMessage(
                createIPCMessage(
                    MainToUtilityMessageType.FILE_TRANSFER_REQUEST_MANIFEST,
                    { peerId, playlistId },
                ),
            )
            // Response arrives asynchronously via FILE_TRANSFER_MANIFEST_RECEIVED
            // and is forwarded to the renderer as an event.
        },
    )

    // file-transfer:request-files
    ipcMain.handle(
        IPC_CHANNELS.FILE_TRANSFER_REQUEST_FILES,
        async (
            _e,
            { peerId, files }: { peerId: string; files: FileEntry[] },
        ) => {
            const utility = utilityGetter()
            if (!utility) {
                throw new Error('P2P utility process is not running')
            }

            for (const file of files) {
                // Task A: Enforce maximum file size
                if (file.sizeBytes > FILE_TRANSFER_CONFIG.MAX_FILE_SIZE) {
                    console.warn(
                        `[FileTransfer] Skipping file ${file.sha256} (${file.filename}): ` +
                        `size ${file.sizeBytes} exceeds MAX_FILE_SIZE ${FILE_TRANSFER_CONFIG.MAX_FILE_SIZE}`,
                    )
                    const errPayload: TransferError = {
                        sha256: file.sha256,
                        trackId: file.trackId,
                        error: 'File exceeds maximum size (500MB)',
                    }
                    win.webContents.send(IPC_CHANNELS.FILE_TRANSFER_ERROR, errPayload)
                    continue
                }

                // Check if we already have this file by sha256
                if (hashCache && hashCache.getPathBySha256(file.sha256)) {
                    // Already have it — emit complete immediately
                    const localFilePath = hashCache.getPathBySha256(file.sha256)!
                    const complete: TransferComplete = {
                        sha256: file.sha256,
                        trackId: file.trackId,
                        type: file.type,
                        localFilePath,
                    }
                    win.webContents.send(IPC_CHANNELS.FILE_TRANSFER_COMPLETE, complete)
                    continue
                }

                // Determine resume offset (bytes already received)
                const partialPath = path.join(partialDir, `${file.sha256}.tmp`)
                let offsetBytes = 0
                try {
                    const stat = await fs.promises.stat(partialPath)
                    offsetBytes = stat.size
                } catch {
                    offsetBytes = 0
                }

                // Register transfer state — sanitize filename from peer before storing
                const transfer: ActiveTransfer = {
                    sha256: file.sha256,
                    trackId: file.trackId,
                    type: file.type,
                    filename: sanitizeFilename(file.filename, file.sha256),
                    totalBytes: file.sizeBytes,
                    bytesReceived: offsetBytes,
                    status: 'pending',
                    peerId,
                    startedAt: new Date().toISOString(),
                }
                activeTransfers.set(file.sha256, transfer)
                speedTrackers.set(file.sha256, {
                    startMs: Date.now(),
                    startBytes: offsetBytes,
                })

                // Task B: Enqueue instead of dispatching immediately
                downloadQueue.push({
                    peerId,
                    sha256: file.sha256,
                    type: file.type,
                    offsetBytes,
                })
            }

            // Task B: Drain the queue now that all items are enqueued
            processQueue()
        },
    )

    // file-transfer:cancel
    ipcMain.handle(
        IPC_CHANNELS.FILE_TRANSFER_CANCEL,
        async (_e, { sha256 }: { sha256: string }) => {
            const transfer = activeTransfers.get(sha256)

            // No active transfer — nothing to cancel (may have already completed or never started)
            if (!transfer) {
                return
            }

            const utility = utilityGetter()
            if (utility) {
                utility.postMessage(
                    createIPCMessage(
                        MainToUtilityMessageType.FILE_TRANSFER_CANCEL,
                        { peerId: transfer.peerId, sha256 },
                    ),
                )
            }

            transfer.status = 'cancelled'
            await closePartialHandle(sha256)

            removeQueuedRequests(sha256)

            // Symmetric with complete/fail: give the slot back and start the next one.
            releaseSlot(sha256)
            processQueue()
            persistTransferState()
        },
    )

    // file-transfer:get-transfers
    ipcMain.handle(IPC_CHANNELS.FILE_TRANSFER_GET_TRANSFERS, () => {
        return Array.from(activeTransfers.values())
    })

    // file-transfer:set-sharing
    ipcMain.handle(
        IPC_CHANNELS.FILE_TRANSFER_SET_SHARING,
        (_e, { playlistId, enabled }: { playlistId: string; enabled: boolean }) => {
            sharingState.set(playlistId, enabled)
            if (!enabled) {
                // Consent is per-exchange: withdrawing sharing withdraws what this
                // playlist's manifests published. Requests arriving after this point
                // are refused; serves already streaming are not aborted.
                servedHashes.revoke(playlistId)
            }
        },
    )

    // file-transfer:register-tracks
    // Renderer pushes a side-map of trackId → local file paths so that
    // handleManifestRequest can build non-empty manifests without a DB round-trip.
    ipcMain.handle(
        IPC_CHANNELS.FILE_TRANSFER_REGISTER_TRACKS,
        (
            _e,
            {
                playlistId,
                coverArtPath,
                tracks,
            }: {
                playlistId: string
                coverArtPath?: string
                tracks: Array<{ trackId: string; audioPath?: string; artworkPath?: string }>
            },
        ) => {
            // Validate and store cover art path
            if (coverArtPath) {
                try {
                    assertPathContained(coverArtPath, artworkDir)
                    playlistCoverMap.set(playlistId, coverArtPath)
                } catch (err) {
                    console.warn(
                        '[FileTransfer] Rejected cover art path for playlist',
                        playlistId,
                        err,
                    )
                }
            }

            // Validate and store per-track paths
            for (const { trackId, audioPath, artworkPath } of tracks) {
                const entry: { audioPath?: string; artworkPath?: string } = {}

                if (audioPath) {
                    try {
                        assertPathContained(audioPath, audioDir)
                        entry.audioPath = audioPath
                    } catch (err) {
                        console.warn(
                            '[FileTransfer] Rejected audio path for track',
                            trackId,
                            err,
                        )
                    }
                }

                if (artworkPath) {
                    try {
                        assertPathContained(artworkPath, artworkDir)
                        entry.artworkPath = artworkPath
                    } catch (err) {
                        console.warn(
                            '[FileTransfer] Rejected artwork path for track',
                            trackId,
                            err,
                        )
                    }
                }

                if (entry.audioPath !== undefined || entry.artworkPath !== undefined) {
                    trackFileMap.set(trackId, entry)
                }
            }

            // Build playlist → trackIds index so handleManifestRequest can scope correctly
            const trackSet = new Set<string>()
            for (const { trackId } of tracks) {
                trackSet.add(trackId)
            }
            playlistTrackMap.set(playlistId, trackSet)
        },
    )

    // ----------------------------------------------------------------
    // Utility → Main message handlers (dispatched from handleUtilityMessage)
    // ----------------------------------------------------------------

    // Store win reference for use in message handlers
    _win = win
    _utilityGetter = utilityGetter
}

// Internal refs set by registerFileTransferHandlers
let _win: BrowserWindow | null = null
let _utilityGetter: (() => UtilityProcess | null) | null = null

/**
 * Record our own peer ID once the P2P node has started.
 * Call this from main.ts when NODE_STARTED fires.
 */
export function setOwnPeerId(peerId: string): void {
    ownPeerId = peerId
}

// ========================================
// Utility process message dispatch
// ========================================

/**
 * Call this from main.ts's handleUtilityProcessMessage switch for file-transfer types.
 * Returns true if the message was handled, false otherwise.
 */
export function handleFileTransferUtilityMessage(message: IPCMessage): boolean {
    switch (message.type) {
        case UtilityToMainMessageType.FILE_TRANSFER_INCOMING_REQUEST: {
            const rawPayload = message.payload as {
                subtype?: string
                peerId: string
                requestId?: string
                playlistId?: string
                trackIds?: string[]
                sha256?: string
                offsetBytes?: number
            }
            if (rawPayload.subtype === 'manifest-request') {
                void handleManifestRequest({
                    requestId: rawPayload.requestId ?? '',
                    peerId: rawPayload.peerId,
                    playlistId: rawPayload.playlistId ?? '',
                    trackIds: rawPayload.trackIds ?? [],
                })
            } else {
                // 'file-request' or legacy (no subtype)
                void handleIncomingRequest({
                    peerId: rawPayload.peerId,
                    sha256: rawPayload.sha256 ?? '',
                    offsetBytes: rawPayload.offsetBytes ?? 0,
                })
            }
            return true
        }

        case UtilityToMainMessageType.FILE_TRANSFER_CHUNK_RECEIVED:
            void handleChunkReceived(
                message.payload as {
                    peerId: string
                    sha256: string
                    offset: number
                    data: string
                },
            )
            return true

        case UtilityToMainMessageType.FILE_TRANSFER_COMPLETE:
            void handleTransferComplete(
                message.payload as { peerId: string; sha256: string },
            )
            return true

        case UtilityToMainMessageType.FILE_TRANSFER_MANIFEST_RECEIVED: {
            const { manifest } = message.payload as { requestId: string; peerId: string; manifest: FileManifest }
            handleManifestReceived(manifest)
            return true
        }

        case UtilityToMainMessageType.FILE_TRANSFER_ERROR:
            handleTransferError(
                message.payload as { sha256: string; trackId?: string; error: string },
            )
            return true

        default:
            return false
    }
}

// ========================================
// Serving files to peers (peer → requests → us)
// ========================================

/**
 * The deny-by-default manifest response: explicitly empty, never silence.
 *
 * Sent both when sharing was off on arrival and when it was turned off while the
 * manifest was being built — the requesting peer must not be able to tell those
 * apart, and must not be left waiting either way.
 */
function sendEmptyManifest(
    utility: UtilityProcess,
    requestId: string,
    peerId: string,
    playlistId: string,
): void {
    const emptyManifest: FileManifest = {
        peerId: ownPeerId,
        playlistId,
        files: [],
        generatedAt: new Date().toISOString(),
    }
    utility.postMessage(
        createIPCMessage(MainToUtilityMessageType.FILE_TRANSFER_MANIFEST_RESPONSE, {
            requestId,
            peerId,
            manifest: emptyManifest,
        }),
    )
}

/**
 * Handles a manifest-request from a remote peer.
 *
 * The remote peer sends FILE_TRANSFER_INCOMING_REQUEST with subtype 'manifest-request'.
 * We build the manifest using our local hash cache + file paths, then send it back to
 * the utility process as FILE_TRANSFER_MANIFEST_RESPONSE so the utility can forward it
 * to the requesting peer over the P2P protocol.
 *
 * We derive trackIds from our own playlistTrackMap (populated by register-tracks) rather
 * than trusting the requesting peer. The wire-protocol trackIds field is ignored — the
 * serving peer is authoritative about which tracks it has registered.
 */
async function handleManifestRequest(payload: {
    requestId: string
    peerId: string
    playlistId: string
    trackIds: string[]
}): Promise<void> {
    const { requestId, peerId, playlistId } = payload
    // Derive trackIds from our own registry — never trust the requesting peer's list
    const trackIds = Array.from(playlistTrackMap.get(playlistId) ?? [])

    const utility = _utilityGetter?.()
    if (!utility) {
        console.warn('[FileTransfer] Cannot send manifest: utility process not running')
        return
    }

    // Task C: Deny-by-default — only respond with real data if sharing is explicitly enabled
    if (!sharingState.get(playlistId)) {
        console.log(
            `[FileTransfer] Manifest request denied for playlist ${playlistId} from peer ${peerId}: sharing not enabled`,
        )
        sendEmptyManifest(utility, requestId, peerId, playlistId)
        return
    }

    if (!hashCache) {
        console.warn('[FileTransfer] Cannot build manifest: hash cache not initialised')
        return
    }

    let manifest: FileManifest
    try {
        manifest = await buildManifest(
            ownPeerId,
            playlistId,
            trackIds,
            (trackId) => trackFileMap.get(trackId)?.audioPath ?? null,
            (trackId) => trackFileMap.get(trackId)?.artworkPath ?? null,
            () => playlistCoverMap.get(playlistId) ?? null,
            hashCache,
        )
    } catch (err) {
        console.error('[FileTransfer] buildManifest failed:', err)
        return
    }

    // Re-check sharing after the build. `buildManifest` stats and hashes every file,
    // so it yields for real I/O, and the `set-sharing` handler is synchronous — a host
    // who toggles sharing off during the build runs `revoke()` to completion inside
    // that window. Without this the `record()` below would silently re-authorize the
    // playlist the host just withdrew, and the peer would get real file data for it.
    // Nothing awaits between here and the postMessage, so the decision cannot go stale.
    if (!sharingState.get(playlistId)) {
        console.log(
            `[FileTransfer] Manifest for playlist ${playlistId} discarded: sharing was disabled while it was being built`,
        )
        sendEmptyManifest(utility, requestId, peerId, playlistId)
        return
    }

    // Authorize exactly what we are about to publish, and nothing else: this is the
    // one point where sharing has been confirmed and the servable set is known.
    servedHashes.record(playlistId, manifest.files)

    utility.postMessage(
        createIPCMessage(MainToUtilityMessageType.FILE_TRANSFER_MANIFEST_RESPONSE, {
            requestId,
            peerId,
            manifest,
        }),
    )
}

async function handleIncomingRequest(payload: {
    peerId: string
    sha256: string
    offsetBytes: number
}): Promise<void> {
    const { peerId, sha256, offsetBytes } = payload

    const cache = hashCache
    if (!cache) {
        // Unreachable in practice (`_utilityGetter` is set after `hashCache`, so no
        // peer request can reach us first), but it answers like every other serve-path
        // refusal regardless: one message for all of them, no oracle by omission.
        console.warn('[FileTransfer] Serve request arrived before initialisation — refusing')
        refuseServe(peerId, sha256)
        return
    }

    // Trust boundary: nothing below this point may read a file, or admit that we
    // hold one, unless sharing published its hash to a peer. See serve-guards.ts.
    const verdict = evaluateServeRequest(sha256, servedHashes, (h) =>
        cache.getPathBySha256(h),
    )
    if (!verdict.ok) {
        console.log(
            `[FileTransfer] Refusing file request from ${peerId.slice(0, 12)}... ` +
            `for ${sha256.slice(0, 8)}... — ${verdict.reason}`,
        )
        refuseServe(peerId, sha256)
        return
    }
    const filePath = verdict.filePath

    let stat: fs.Stats
    try {
        stat = await fs.promises.stat(filePath)
    } catch {
        sendServeError(peerId, sha256, `File no longer exists: ${filePath}`)
        return
    }

    const utility = _utilityGetter?.()
    if (!utility) {
        console.warn('[FileTransfer] Cannot serve: utility process not running')
        return
    }

    const totalBytes = stat.size
    const chunkSize = FILE_TRANSFER_CONFIG.CHUNK_SIZE

    // Send file-header
    utility.postMessage(
        createIPCMessage(MainToUtilityMessageType.FILE_TRANSFER_SERVE_CHUNK, {
            peerId,
            message: { type: 'file-header', sha256, totalBytes, chunkSize },
        }),
    )

    // Stream chunks
    try {
        const stream = fs.createReadStream(filePath, {
            start: offsetBytes,
            highWaterMark: chunkSize,
        })

        let offset = offsetBytes
        for await (const chunk of stream) {
            const data = (chunk as Buffer).toString('base64')
            utility.postMessage(
                createIPCMessage(MainToUtilityMessageType.FILE_TRANSFER_SERVE_CHUNK, {
                    peerId,
                    message: { type: 'file-chunk', sha256, offset, data },
                }),
            )
            offset += (chunk as Buffer).length
        }

        // Send file-complete
        utility.postMessage(
            createIPCMessage(MainToUtilityMessageType.FILE_TRANSFER_SERVE_CHUNK, {
                peerId,
                message: { type: 'file-complete', sha256 },
            }),
        )
    } catch (err) {
        const error = err instanceof Error ? err.message : String(err)
        console.error('[FileTransfer] Error serving file:', error)
        sendServeError(peerId, sha256, error)
    }
}

/**
 * The single answer every serve-path refusal gets — "we don't have that file" —
 * whether we hold it and sharing never published it, or we genuinely have never
 * seen it. One message for all refusals is what stops a peer from using them to
 * enumerate the user's library, so this exists to make divergence impossible
 * rather than merely unlikely.
 */
function refuseServe(peerId: string, sha256: string): void {
    sendServeError(peerId, sha256, `No file found for sha256: ${sha256}`)
}

function sendServeError(peerId: string, sha256: string, error: string): void {
    const utility = _utilityGetter?.()
    if (!utility) return
    utility.postMessage(
        createIPCMessage(MainToUtilityMessageType.FILE_TRANSFER_SERVE_CHUNK, {
            peerId,
            message: { type: 'file-error', sha256, error },
        }),
    )
}

// ========================================
// Receiving files from peers (peer → chunks → us)
// ========================================

async function handleChunkReceived(payload: {
    peerId: string
    sha256: string
    offset: number
    data: string
}): Promise<void> {
    const { peerId, sha256, offset } = payload

    // Trust boundary: nothing below this point may touch the filesystem for a chunk
    // we did not ask for. See chunk-guards.ts for why drop != fail.
    const verdict = evaluateInboundChunk(payload, activeTransfers.get(sha256))
    if (!verdict.ok) {
        if (verdict.action === 'fail') {
            console.error(
                `[FileTransfer] Failing transfer ${sha256.slice(0, 8)}... — ${verdict.reason}`,
            )
            await abortTransfer(peerId, sha256, verdict.reason)
        } else {
            console.warn(
                `[FileTransfer] Dropped chunk from ${peerId.slice(0, 12)}... — ${verdict.reason}`,
            )
        }
        return
    }

    const chunkBuf = verdict.chunk
    const partialPath = path.join(partialDir, `${sha256}.tmp`)

    // Open (or join) this transfer's single file handle. The promise goes into the map
    // *before* the first await, so a concurrent chunk for the same sha256 waits on this
    // open rather than starting a second one.
    let opening = partialHandles.get(sha256)
    if (!opening) {
        opening = openPartial(partialPath)
        partialHandles.set(sha256, opening)
    }

    let handle: fs.promises.FileHandle
    try {
        handle = await opening
    } catch (err) {
        // A failed open must not be cached, or every later chunk inherits the failure.
        if (partialHandles.get(sha256) === opening) partialHandles.delete(sha256)
        console.error('[FileTransfer] Cannot open partial file:', err)
        return
    }

    // Re-check after the await, the way `handleManifestRequest` re-checks sharing after
    // its build: completion, abort or cancel may have torn this transfer down while we
    // were opening. `closePartialHandle` drops the map entry synchronously, so a lost
    // identity means the handle we hold is closed and the `.tmp` is being renamed or
    // unlinked right now — writing here would resurrect a partial we just finished with.
    if (partialHandles.get(sha256) !== opening) {
        console.warn(
            `[FileTransfer] Dropped chunk for ${sha256.slice(0, 8)}... — transfer was closed while opening its partial`,
        )
        return
    }

    try {
        await handle.write(chunkBuf, 0, chunkBuf.length, offset)
    } catch (err) {
        // Same re-check: if teardown closed the handle under this write, the transfer is
        // over, not broken — failing it here would delete a `.tmp` mid-rename.
        if (partialHandles.get(sha256) !== opening) {
            console.warn(
                `[FileTransfer] Dropped chunk for ${sha256.slice(0, 8)}... — transfer was closed mid-write`,
            )
            return
        }
        const errMsg = err instanceof Error ? err.message : String(err)
        console.error('[FileTransfer] Failed to write chunk:', errMsg)
        // Task D: abort transfer — corrupt partial is useless; stop the peer sending more chunks
        await abortTransfer(peerId, sha256, 'Disk write failed: ' + errMsg)
        return
    }

    // Update transfer state
    const transfer = activeTransfers.get(sha256)
    if (transfer) {
        // Re-take the maximum: chunks are dispatched concurrently (`void handleChunkReceived`),
        // so the high-water mark computed before the await above can be stale by now.
        // Both operands are already bounded by totalBytes (see chunk-guards).
        transfer.bytesReceived = Math.max(transfer.bytesReceived, verdict.bytesReceived)
        transfer.status = 'transferring'

        const tracker = speedTrackers.get(sha256)
        const bps = tracker
            ? calcBps(
                  tracker.startMs,
                  tracker.startBytes,
                  transfer.bytesReceived,
              )
            : 0

        if (_win) {
            const progress: TransferProgress = {
                sha256,
                trackId: transfer.trackId,
                bytesReceived: transfer.bytesReceived,
                totalBytes: transfer.totalBytes,
                bytesPerSecond: bps,
            }
            _win.webContents.send(IPC_CHANNELS.FILE_TRANSFER_PROGRESS, progress)
        }
        persistTransferState()
    }
}

async function handleTransferComplete(payload: {
    peerId: string
    sha256: string
}): Promise<void> {
    const { sha256 } = payload

    if (!isValidSha256(sha256)) {
        console.error('[FileTransfer] handleTransferComplete: invalid sha256 rejected:', sha256)
        failTransfer(sha256, 'Invalid sha256 format')
        return
    }

    const transfer = activeTransfers.get(sha256)

    // Flip the status before anything is awaited, exactly as `abortTransfer` does: from
    // here on the file belongs to verification and the rename, so a chunk still in
    // flight must be dropped by the guard rather than reopening the partial underneath
    // us. Doing this after the close (as it used to be) left a window in which a late
    // chunk saw 'transferring', reopened a descriptor and recreated the `.tmp`.
    if (transfer) transfer.status = 'verifying'

    // Task B: release the in-flight slot before draining the queue
    releaseSlot(sha256)
    processQueue()

    await closePartialHandle(sha256)

    if (!transfer) {
        console.warn('[FileTransfer] complete received for unknown transfer:', sha256)
        return
    }

    const partialPath = path.join(partialDir, `${sha256}.tmp`)

    // Verify hash
    let actualHash: string
    try {
        actualHash = await computeFileSha256(partialPath)
    } catch (err) {
        const error = err instanceof Error ? err.message : String(err)
        failTransfer(sha256, `Hash verification failed: ${error}`)
        return
    }

    if (actualHash !== sha256) {
        await fs.promises.unlink(partialPath).catch(() => undefined)
        failTransfer(sha256, `Hash mismatch: expected ${sha256}, got ${actualHash}`)
        return
    }

    // Determine final path — defense in depth: verify containment even after sanitization
    const targetDir = transfer.type === 'audio' ? audioDir : artworkDir
    let finalPath = path.join(targetDir, transfer.filename)

    try {
        assertPathContained(finalPath, targetDir)
    } catch (err) {
        const error = err instanceof Error ? err.message : String(err)
        failTransfer(sha256, `Rejected: ${error}`)
        await fs.promises.unlink(partialPath).catch(() => undefined)
        return
    }

    // Resolve collisions
    try {
        finalPath = await resolveCollision(finalPath)
    } catch (err) {
        const error = err instanceof Error ? err.message : String(err)
        failTransfer(sha256, `Rejected: ${error}`)
        await fs.promises.unlink(partialPath).catch(() => undefined)
        return
    }

    try {
        await fs.promises.rename(partialPath, finalPath)
    } catch (err) {
        const error = err instanceof Error ? err.message : String(err)
        failTransfer(sha256, `Failed to move file to final location: ${error}`)
        return
    }

    // Register in hash cache
    if (hashCache) {
        await hashCache.register(finalPath, sha256)
    }

    transfer.status = 'complete'
    activeTransfers.set(sha256, transfer)
    persistTransferState()

    if (_win) {
        const complete: TransferComplete = {
            sha256,
            trackId: transfer.trackId,
            type: transfer.type,
            localFilePath: finalPath,
        }
        _win.webContents.send(IPC_CHANNELS.FILE_TRANSFER_COMPLETE, complete)
    }
}

function handleManifestReceived(manifest: FileManifest): void {
    if (_win) {
        _win.webContents.send(IPC_CHANNELS.FILE_TRANSFER_MANIFEST, manifest)
    }
}

function handleTransferError(payload: {
    sha256: string
    trackId?: string
    error: string
}): void {
    const { sha256, error } = payload
    const transfer = activeTransfers.get(sha256)

    if (transfer) {
        failTransfer(sha256, error)
    } else if (_win) {
        // Unknown transfer — still forward to renderer with best-effort trackId
        const errPayload: TransferError = {
            sha256,
            trackId: payload.trackId ?? '',
            error,
        }
        _win.webContents.send(IPC_CHANNELS.FILE_TRANSFER_ERROR, errPayload)
    }
}

// ========================================
// Helpers
// ========================================

/**
 * Open a partial file for random-access writing.
 *
 * We need positional writes (offset-based chunks), so we must use 'r+', which will not
 * create the file — hence the 'a' open first. Unchanged behaviour; it lives in its own
 * function only so the whole open can be handed to `partialHandles` as one promise.
 */
async function openPartial(partialPath: string): Promise<fs.promises.FileHandle> {
    // Create the file if it doesn't exist, then open for random-access writing
    await fs.promises.open(partialPath, 'a').then((h) => h.close())
    return fs.promises.open(partialPath, 'r+')
}

/**
 * Close a transfer's partial handle and forget it. Idempotent: a second call (complete
 * then a late error, cancel then complete, …) finds nothing and returns without throwing.
 *
 * The map entry is dropped *synchronously*, before awaiting the open — that is what
 * makes the identity re-checks in `handleChunkReceived` correct. Awaiting the open (as
 * opposed to ignoring an in-flight one) is what stops an open that started before
 * teardown from recreating the `.tmp` after the rename or unlink.
 */
async function closePartialHandle(sha256: string): Promise<void> {
    const opening = partialHandles.get(sha256)
    if (!opening) return
    partialHandles.delete(sha256)
    try {
        const handle = await opening
        await handle.close()
    } catch {
        // best effort — a failed open has nothing to close, a double close is a no-op
    }
}

/**
 * Fail a transfer, tell the sending peer to stop, and discard the partial: used when
 * the bytes arriving from the peer we asked cannot be written (bad offset, oversize
 * chunk, disk error).
 *
 * The whole prologue is synchronous: the handle is detached and the status flips to
 * `error` before anything is awaited, so a chunk still in flight for this transfer is
 * dropped — by the guard if it has not started yet, by the identity re-check if it is
 * mid-open — rather than recreating the file we are about to delete.
 *
 * The close is started *here* rather than left to `failTransfer`, which fires it off
 * with `void`: only a close we can await tells us that an open still in flight has
 * finished, and the unlink below must not overtake one (`open(path, 'a')` creates).
 */
async function abortTransfer(peerId: string, sha256: string, error: string): Promise<void> {
    const closed = closePartialHandle(sha256)
    failTransfer(sha256, error)

    const utility = _utilityGetter?.()
    if (utility) {
        utility.postMessage(
            createIPCMessage(MainToUtilityMessageType.FILE_TRANSFER_CANCEL, { peerId, sha256 }),
        )
    }

    await closed
    // A peer that oversteps its own declared size is not a peer whose partial we want
    // to resume from, and a partial we failed to write to is useless anyway.
    await fs.promises.unlink(path.join(partialDir, `${sha256}.tmp`)).catch(() => undefined)
}

function failTransfer(sha256: string, error: string): void {
    const transfer = activeTransfers.get(sha256)
    if (transfer) {
        transfer.status = 'error'
        transfer.error = error
    }
    // Task B: release the in-flight slot (exactly once) before draining the queue
    removeQueuedRequests(sha256)
    releaseSlot(sha256)
    processQueue()
    persistTransferState()
    if (_win) {
        const errPayload: TransferError = {
            sha256,
            trackId: transfer?.trackId ?? '',
            error,
        }
        _win.webContents.send(IPC_CHANNELS.FILE_TRANSFER_ERROR, errPayload)
    }
    // Close any open handle
    void closePartialHandle(sha256)
}

function calcBps(startMs: number, startBytes: number, currentBytes: number): number {
    const elapsedSec = (Date.now() - startMs) / 1000
    if (elapsedSec < 0.001) return 0
    return Math.round((currentBytes - startBytes) / elapsedSec)
}

/**
 * If finalPath already exists, append -2, -3, etc. until we find a free slot.
 */
async function resolveCollision(filePath: string): Promise<string> {
    try {
        await fs.promises.access(filePath)
    } catch {
        return filePath // does not exist — use as-is
    }

    const dir = path.dirname(filePath)
    const ext = path.extname(filePath)
    const base = path.basename(filePath, ext)
    let n = 2
    while (n <= 1000) {
        const candidate = path.join(dir, `${base}-${n}${ext}`)
        try {
            await fs.promises.access(candidate)
            n++
        } catch {
            return candidate
        }
    }
    throw new Error(`Too many filename collisions for '${path.basename(filePath)}'`)
}
