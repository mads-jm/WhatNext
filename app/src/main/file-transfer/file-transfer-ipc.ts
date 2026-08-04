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
import * as crypto from 'crypto'
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

/** trackId → local file paths registered by the renderer */
const trackFileMap = new Map<string, { audioPath?: string; artworkPath?: string }>()

/** playlistId → cover art local path registered by the renderer */
const playlistCoverMap = new Map<string, string>()

/** playlistId → Set of trackIds registered by the renderer via register-tracks */
const playlistTrackMap = new Map<string, Set<string>>()

/** sha256 → ActiveTransfer (download state, peer → us) */
const activeTransfers = new Map<string, ActiveTransfer>()

/** sha256 → open file handle (for partial writes) */
const partialHandles = new Map<string, fs.promises.FileHandle>()

/** sha256 → bytes-per-second tracker */
const speedTrackers = new Map<string, { startMs: number; startBytes: number }>()

/** Debounce timer for persistTransferState — at most one write per second */
let persistTimer: NodeJS.Timeout | null = null

// ========================================
// Download queue (concurrency control)
// ========================================

/** Pending download requests not yet dispatched to the utility process */
const downloadQueue: Array<{ peerId: string; file: FileEntry; offsetBytes: number }> = []

/** Number of audio transfers currently in-flight */
let activeAudioCount = 0

/** Number of artwork/cover-art transfers currently in-flight */
let activeArtworkCount = 0

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
        const isAudio = item.file.type === 'audio'

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

        utility.postMessage(
            createIPCMessage(
                MainToUtilityMessageType.FILE_TRANSFER_REQUEST_FILE,
                { peerId: item.peerId, sha256: item.file.sha256, offsetBytes: item.offsetBytes },
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
 */
export async function resumeIncompleteTransfers(peerId: string): Promise<void> {
    const utility = _utilityGetter?.()
    if (!utility) return

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

        transfer.status = 'transferring'
        speedTrackers.set(sha256, { startMs: Date.now(), startBytes: offsetBytes })

        console.log(
            `[FileTransfer] Resuming transfer ${sha256} for peer ${peerId} at offset ${offsetBytes}`,
        )

        utility.postMessage(
            createIPCMessage(
                MainToUtilityMessageType.FILE_TRANSFER_REQUEST_FILE,
                { peerId, sha256, offsetBytes },
            ),
        )
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
                downloadQueue.push({ peerId, file, offsetBytes })
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

    if (!hashCache) {
        sendServeError(peerId, sha256, 'File transfer not initialised')
        return
    }

    const filePath = hashCache.getPathBySha256(sha256)
    if (!filePath) {
        sendServeError(peerId, sha256, `No file found for sha256: ${sha256}`)
        return
    }

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
    const { sha256, offset, data } = payload

    if (!isValidSha256(sha256)) {
        console.error('[FileTransfer] handleChunkReceived: invalid sha256 rejected:', sha256)
        failTransfer(sha256, 'Invalid sha256 format')
        return
    }

    const chunkBuf = Buffer.from(data, 'base64')
    const partialPath = path.join(partialDir, `${sha256}.tmp`)

    // Open (or reuse) file handle.
    // We need positional writes (offset-based chunks), so we must use 'r+'.
    // First ensure the file exists, then open with 'r+' which supports pwrite semantics.
    let handle = partialHandles.get(sha256)
    if (!handle) {
        try {
            // Create the file if it doesn't exist, then open for random-access writing
            await fs.promises.open(partialPath, 'a').then((h) => h.close())
            handle = await fs.promises.open(partialPath, 'r+')
            partialHandles.set(sha256, handle)
        } catch (err) {
            console.error('[FileTransfer] Cannot open partial file:', err)
            return
        }
    }

    try {
        await handle.write(chunkBuf, 0, chunkBuf.length, offset)
    } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err)
        console.error('[FileTransfer] Failed to write chunk:', errMsg)
        // Task D: abort transfer — corrupt partial is useless; stop the peer sending more chunks
        failTransfer(sha256, 'Disk write failed: ' + errMsg)
        const utility = _utilityGetter?.()
        if (utility) {
            utility.postMessage(
                createIPCMessage(
                    MainToUtilityMessageType.FILE_TRANSFER_CANCEL,
                    { peerId: payload.peerId, sha256 },
                ),
            )
        }
        await closePartialHandle(sha256)
        return
    }

    // Update transfer state
    const transfer = activeTransfers.get(sha256)
    if (transfer) {
        transfer.bytesReceived = offset + chunkBuf.length
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

    // Task B: decrement in-flight counter before draining the queue
    const completedTransfer = activeTransfers.get(sha256)
    if (completedTransfer) {
        if (completedTransfer.type === 'audio') {
            activeAudioCount = Math.max(0, activeAudioCount - 1)
        } else {
            activeArtworkCount = Math.max(0, activeArtworkCount - 1)
        }
    }
    processQueue()

    await closePartialHandle(sha256)

    const transfer = activeTransfers.get(sha256)
    if (!transfer) {
        console.warn('[FileTransfer] complete received for unknown transfer:', sha256)
        return
    }

    transfer.status = 'verifying'

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

async function closePartialHandle(sha256: string): Promise<void> {
    const handle = partialHandles.get(sha256)
    if (handle) {
        try {
            await handle.close()
        } catch {
            // best effort
        }
        partialHandles.delete(sha256)
    }
}

function failTransfer(sha256: string, error: string): void {
    const transfer = activeTransfers.get(sha256)
    if (transfer) {
        transfer.status = 'error'
        transfer.error = error

        // Task B: decrement in-flight counter before draining the queue
        if (transfer.type === 'audio') {
            activeAudioCount = Math.max(0, activeAudioCount - 1)
        } else {
            activeArtworkCount = Math.max(0, activeArtworkCount - 1)
        }
    }
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
