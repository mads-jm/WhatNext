/**
 * WhatNext File Transfer Protocol
 * /whatnext/file-transfer/1.0.0
 *
 * Chunked binary file transfer between peers over a persistent libp2p stream.
 *
 * Message framing: each JSON message is prefixed with a 4-byte big-endian uint32
 * containing the byte length of the JSON payload. This enables reliable parsing of
 * multiple messages on a single stream without relying on newlines or EOF.
 *
 * Stream lifecycle:
 *   manifest-request/response  — single stream, open → send request → read response → close
 *   file-request/chunks        — persistent stream, open → send file-request →
 *                                receive file-header + N×file-chunk + file-complete → close
 *   file-error / transfer-cancel — sent on a new short-lived stream (either side)
 */

import type { Libp2p, Stream, Connection } from '@libp2p/interface'
import type { PeerId } from '@libp2p/interface'
import type { FileManifest, FileTransferMessage } from '../../shared/core/file-transfer-types'
import { FILE_TRANSFER_CONFIG } from '../../shared/core/file-transfer-types'

const PROTOCOL = FILE_TRANSFER_CONFIG.PROTOCOL_ID

// Largest legitimate message is ~87KB (64KB chunk base64-encoded in JSON).
// Reject anything beyond this before allocating, to prevent remote DoS via
// a crafted 0xFFFFFFFF length prefix causing a ~4GB allocation attempt.
const MAX_MESSAGE_SIZE = 10 * 1024 * 1024 // 10MB

// ========================================
// Framing Helpers
// ========================================

/**
 * Encode a message with a 4-byte big-endian length prefix.
 */
function encodeFramed(data: unknown): Uint8Array {
    const json = new TextEncoder().encode(JSON.stringify(data))
    const frame = new Uint8Array(4 + json.length)
    const view = new DataView(frame.buffer)
    view.setUint32(0, json.length, false) // big-endian
    frame.set(json, 4)
    return frame
}

/**
 * Accumulate raw bytes from a stream until at least `needed` bytes are available.
 * Returns `null` if the stream ends before enough bytes arrive.
 */
async function accumulateBytes(
    iter: AsyncIterator<Uint8Array | { subarray(): Uint8Array }>,
    needed: number,
    carry: Uint8Array
): Promise<{ buf: Uint8Array; rest: Uint8Array } | null> {
    let buf = carry
    while (buf.length < needed) {
        const { value, done } = await iter.next()
        if (done || value === undefined) return null
        const chunk = value instanceof Uint8Array ? value : value.subarray()
        const merged = new Uint8Array(buf.length + chunk.length)
        merged.set(buf, 0)
        merged.set(chunk, buf.length)
        buf = merged
    }
    return { buf: buf.slice(0, needed), rest: buf.slice(needed) }
}

/**
 * Read a single length-prefixed JSON message from a stream.
 * `carry` holds any bytes already read from a previous partial read.
 */
async function readFramedMessage<T>(
    iter: AsyncIterator<Uint8Array | { subarray(): Uint8Array }>,
    carry: Uint8Array
): Promise<{ message: T; rest: Uint8Array } | null> {
    // Read 4-byte length prefix
    const headerResult = await accumulateBytes(iter, 4, carry)
    if (!headerResult) return null

    const view = new DataView(headerResult.buf.buffer, headerResult.buf.byteOffset)
    const length = view.getUint32(0, false) // big-endian

    if (length === 0) {
        throw new Error(`readFramedMessage: rejected zero-length message`)
    }
    if (length > MAX_MESSAGE_SIZE) {
        throw new Error(
            `readFramedMessage: rejected oversized message (length=${length}, max=${MAX_MESSAGE_SIZE})`
        )
    }

    // Read the JSON body
    const bodyResult = await accumulateBytes(iter, length, headerResult.rest)
    if (!bodyResult) return null

    try {
        const message = JSON.parse(new TextDecoder().decode(bodyResult.buf)) as T
        return { message, rest: bodyResult.rest }
    } catch {
        return null
    }
}

// ========================================
// Active Stream Registry
// ========================================

/**
 * Maps `peerId:sha256` → open stream used to serve chunks to that peer.
 * Populated by the incoming file-request handler; written to by sendFileChunk.
 */
const activeServeStreams: Map<string, Stream> = new Map()

/**
 * Maps `peerId:sha256` → open stream we opened to receive a file from that peer.
 * Populated by requestFile; cleaned up after file-complete or file-error.
 */
const activeReceiveStreams: Map<string, Stream> = new Map()

function serveKey(peerId: string, sha256: string): string {
    return `${peerId}:${sha256}`
}

/**
 * Close and remove all stream registry entries associated with a peer.
 * Call this when a peer disconnects to prevent stale entries blocking future transfers.
 */
export async function cleanupPeerStreams(peerId: string): Promise<void> {
    const prefix = `${peerId}:`

    for (const [key, stream] of activeServeStreams) {
        if (key.startsWith(prefix)) {
            console.log(`[FileTransfer] Cleanup serve stream for disconnected peer: ${peerId.slice(0, 12)}... key=${key}`)
            activeServeStreams.delete(key)
            try { await stream.close() } catch { /* ignore */ }
        }
    }

    for (const [key, stream] of activeReceiveStreams) {
        if (key.startsWith(prefix)) {
            console.log(`[FileTransfer] Cleanup receive stream for disconnected peer: ${peerId.slice(0, 12)}... key=${key}`)
            activeReceiveStreams.delete(key)
            try { await stream.close() } catch { /* ignore */ }
        }
    }
}

// ========================================
// Protocol Callbacks
// ========================================

export interface FileTransferCallbacks {
    /** Peer wants our manifest for a playlist — return it. */
    onManifestRequest: (peerId: string, playlistId: string) => Promise<FileManifest>
    /** Peer wants a file we have — main process should start serving chunks via sendFileChunk. */
    onFileRequest: (peerId: string, sha256: string, offsetBytes: number) => void
    /** We received a chunk while downloading from a peer. */
    onFileChunkReceived: (peerId: string, sha256: string, offset: number, data: string) => void
    /** Transfer finished successfully. */
    onFileComplete: (peerId: string, sha256: string) => void
    /** Transfer failed. */
    onFileError: (peerId: string, sha256: string, error: string) => void
    /** Transfer was cancelled by the remote side. */
    onTransferCancel: (peerId: string, sha256: string) => void
}

// ========================================
// Protocol Registration
// ========================================

/**
 * Register the file-transfer protocol handler on this libp2p node.
 *
 * Incoming stream message dispatch:
 *   manifest-request → resolve manifest → send manifest-response on same stream
 *   file-request     → register stream in activeServeStreams, notify main to start serving
 *   file-chunk       → forward to main (writing to disk happens there)
 *   file-complete    → notify main, clean up receive stream
 *   file-error       → notify main, clean up receive stream
 *   transfer-cancel  → notify main, clean up both stream registries
 */
export function registerFileTransferProtocol(
    libp2p: Libp2p,
    callbacks: FileTransferCallbacks
): void {
    libp2p.handle(PROTOCOL, async (stream: Stream, connection: Connection) => {
        const remotePeerId = connection.remotePeer.toString()
        const shortId = remotePeerId.slice(0, 12)

        console.log(`[FileTransfer] Incoming stream from ${shortId}...`)

        try {
            // Read the first message to determine intent
            const iter = (stream as unknown as AsyncIterable<Uint8Array | { subarray(): Uint8Array }>)[Symbol.asyncIterator]()
            const firstRead = await readFramedMessage<FileTransferMessage>(iter, new Uint8Array(0))

            if (!firstRead) {
                console.warn(`[FileTransfer] Empty or malformed first message from ${shortId}`)
                await stream.close()
                return
            }

            const { message, rest } = firstRead

            switch (message.type) {
                case 'manifest-request': {
                    console.log(`[FileTransfer] Manifest request from ${shortId} for playlist ${message.playlistId}`)
                    try {
                        const manifest = await callbacks.onManifestRequest(remotePeerId, message.playlistId)
                        const response: FileTransferMessage = { type: 'manifest-response', manifest }
                        stream.send(encodeFramed(response))
                    } catch (err) {
                        const errMsg = err instanceof Error ? err.message : String(err)
                        console.error(`[FileTransfer] Failed to build manifest: ${errMsg}`)
                        const errResp: FileTransferMessage = {
                            type: 'file-error',
                            sha256: '',
                            error: `manifest-error: ${errMsg}`,
                        }
                        stream.send(encodeFramed(errResp))
                    } finally {
                        try { await stream.close() } catch { /* ignore */ }
                    }
                    break
                }

                case 'file-request': {
                    const { sha256, offsetBytes } = message
                    console.log(`[FileTransfer] File request from ${shortId} for ${sha256.slice(0, 8)}... offset=${offsetBytes}`)

                    // Park this stream in the registry — sendFileChunk will write to it
                    const key = serveKey(remotePeerId, sha256)
                    activeServeStreams.set(key, stream)

                    // Notify main to start serving; rest of interaction is outbound via sendFileChunk
                    callbacks.onFileRequest(remotePeerId, sha256, offsetBytes)

                    // The stream stays open until main closes it via sendFileChunk (file-complete/error)
                    // We intentionally do NOT await here — the stream lifetime is managed externally
                    break
                }

                case 'file-chunk': {
                    // We are receiving a file; this is a chunk arriving on the receive stream
                    // (This path fires when the provider sends chunks back on the same stream
                    //  that we opened with file-request. The handler is re-entered per message
                    //  via the looped read below.)
                    const { sha256, offset, data } = message
                    callbacks.onFileChunkReceived(remotePeerId, sha256, offset, data)

                    // Continue reading more messages on this same stream
                    await handleIncomingFileStream(iter, rest, remotePeerId, callbacks, stream)
                    break
                }

                case 'file-complete': {
                    console.log(`[FileTransfer] File complete from ${shortId} for ${message.sha256.slice(0, 8)}...`)
                    callbacks.onFileComplete(remotePeerId, message.sha256)
                    activeReceiveStreams.delete(serveKey(remotePeerId, message.sha256))
                    try { await stream.close() } catch { /* ignore */ }
                    break
                }

                case 'file-error': {
                    console.error(`[FileTransfer] File error from ${shortId}: ${message.error}`)
                    callbacks.onFileError(remotePeerId, message.sha256, message.error)
                    activeReceiveStreams.delete(serveKey(remotePeerId, message.sha256))
                    try { await stream.close() } catch { /* ignore */ }
                    break
                }

                case 'transfer-cancel': {
                    console.log(`[FileTransfer] Transfer cancelled by ${shortId} for ${message.sha256.slice(0, 8)}...`)
                    callbacks.onTransferCancel(remotePeerId, message.sha256)
                    // Clean up whichever registry has this stream
                    activeServeStreams.delete(serveKey(remotePeerId, message.sha256))
                    activeReceiveStreams.delete(serveKey(remotePeerId, message.sha256))
                    try { await stream.close() } catch { /* ignore */ }
                    break
                }

                default: {
                    console.warn(`[FileTransfer] Unknown message type from ${shortId}`)
                    try { await stream.close() } catch { /* ignore */ }
                    break
                }
            }
        } catch (err) {
            console.error(`[FileTransfer] Stream error from ${shortId}:`, err)
            try { await stream.close() } catch { /* ignore */ }
        }
    })

    console.log(`[FileTransfer] Protocol registered: ${PROTOCOL}`)
}

/**
 * Read subsequent framed messages off a receive stream (after the initial file-chunk).
 * Called in a loop for the provider→requester side of a file transfer.
 */
async function handleIncomingFileStream(
    iter: AsyncIterator<Uint8Array | { subarray(): Uint8Array }>,
    carry: Uint8Array,
    remotePeerId: string,
    callbacks: FileTransferCallbacks,
    stream: Stream
): Promise<void> {
    let remaining = carry
    while (true) {
        const result = await readFramedMessage<FileTransferMessage>(iter, remaining)
        if (!result) break // stream ended

        const { message, rest } = result
        remaining = rest

        switch (message.type) {
            case 'file-header': {
                console.log(`[FileTransfer] File header: ${message.sha256.slice(0, 8)}... totalBytes=${message.totalBytes}`)
                if (message.totalBytes > FILE_TRANSFER_CONFIG.MAX_FILE_SIZE) {
                    console.warn(
                        `[FileTransfer] Rejecting file-header: size ${message.totalBytes} exceeds MAX_FILE_SIZE ${FILE_TRANSFER_CONFIG.MAX_FILE_SIZE} for ${message.sha256.slice(0, 8)}...`
                    )
                    const cancelMsg: FileTransferMessage = { type: 'transfer-cancel', sha256: message.sha256 }
                    stream.send(encodeFramed(cancelMsg))
                    activeReceiveStreams.delete(serveKey(remotePeerId, message.sha256))
                    try { await stream.close() } catch { /* ignore */ }
                    callbacks.onFileError(
                        remotePeerId,
                        message.sha256,
                        `file too large: ${message.totalBytes} bytes exceeds limit of ${FILE_TRANSFER_CONFIG.MAX_FILE_SIZE} bytes`
                    )
                    return
                }
                break
            }

            case 'file-chunk':
                callbacks.onFileChunkReceived(remotePeerId, message.sha256, message.offset, message.data)
                break

            case 'file-complete':
                console.log(`[FileTransfer] File complete: ${message.sha256.slice(0, 8)}...`)
                callbacks.onFileComplete(remotePeerId, message.sha256)
                activeReceiveStreams.delete(serveKey(remotePeerId, message.sha256))
                try { await stream.close() } catch { /* ignore */ }
                return

            case 'file-error':
                console.error(`[FileTransfer] File error: ${message.error}`)
                callbacks.onFileError(remotePeerId, message.sha256, message.error)
                activeReceiveStreams.delete(serveKey(remotePeerId, message.sha256))
                try { await stream.close() } catch { /* ignore */ }
                return

            case 'transfer-cancel':
                callbacks.onTransferCancel(remotePeerId, message.sha256)
                activeReceiveStreams.delete(serveKey(remotePeerId, message.sha256))
                try { await stream.close() } catch { /* ignore */ }
                return

            default:
                console.warn(`[FileTransfer] Unexpected message type in file stream: ${(message as FileTransferMessage).type}`)
                break
        }
    }
}

// ========================================
// Outbound Functions
// ========================================

/**
 * Request a file manifest from a peer for a given playlist.
 * Opens a stream, sends manifest-request, reads manifest-response, closes stream.
 */
export async function requestManifest(
    libp2p: Libp2p,
    peerId: PeerId,
    playlistId: string
): Promise<FileManifest> {
    const shortId = peerId.toString().slice(0, 12)
    console.log(`[FileTransfer] Requesting manifest from ${shortId} for playlist ${playlistId}`)

    const stream = await libp2p.dialProtocol(peerId, PROTOCOL)

    try {
        const request: FileTransferMessage = { type: 'manifest-request', playlistId }
        stream.send(encodeFramed(request))

        // Read the response
        const iter = (stream as unknown as AsyncIterable<Uint8Array | { subarray(): Uint8Array }>)[Symbol.asyncIterator]()
        const result = await readFramedMessage<FileTransferMessage>(iter, new Uint8Array(0))

        if (!result) {
            throw new Error('No response received for manifest-request')
        }

        if (result.message.type === 'manifest-response') {
            return result.message.manifest
        }

        if (result.message.type === 'file-error') {
            throw new Error(result.message.error)
        }

        throw new Error(`Unexpected response type: ${result.message.type}`)
    } finally {
        try { await stream.close() } catch { /* ignore */ }
    }
}

/**
 * Request a file from a peer.
 *
 * Opens a persistent stream, sends a file-request, then immediately starts a
 * fire-and-forget read loop on the same stream to consume the provider's response:
 * file-header → N×file-chunk → file-complete (or file-error / transfer-cancel).
 */
export async function requestFile(
    libp2p: Libp2p,
    peerId: PeerId,
    sha256: string,
    offsetBytes: number,
    callbacks: FileTransferCallbacks
): Promise<void> {
    const remotePeerId = peerId.toString()
    const shortId = remotePeerId.slice(0, 12)
    console.log(`[FileTransfer] Requesting file ${sha256.slice(0, 8)}... from ${shortId} offset=${offsetBytes}`)

    const stream = await libp2p.dialProtocol(peerId, PROTOCOL)

    const key = serveKey(remotePeerId, sha256)
    activeReceiveStreams.set(key, stream)

    const request: FileTransferMessage = { type: 'file-request', sha256, offsetBytes }
    stream.send(encodeFramed(request))

    // Fire-and-forget: read the provider's response messages from this same stream.
    // The provider sends file-header → N×file-chunk → file-complete back on the
    // stream we opened. We don't await this — requestFile returns immediately.
    ;(async () => {
        try {
            const iter = (stream as unknown as AsyncIterable<Uint8Array | { subarray(): Uint8Array }>)[Symbol.asyncIterator]()
            await handleIncomingFileStream(iter, new Uint8Array(0), remotePeerId, callbacks, stream)
        } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err)
            console.error(`[FileTransfer] Receive stream error for ${sha256.slice(0, 8)}... from ${shortId}: ${errMsg}`)
            activeReceiveStreams.delete(key)
            callbacks.onFileError(remotePeerId, sha256, `stream-error: ${errMsg}`)
            try { await stream.close() } catch { /* ignore */ }
        }
    })()
}

/**
 * Send a chunk (or file-header / file-complete / file-error) to a peer.
 *
 * Used by the main process when serving a file to a requesting peer.
 * Writes to the stream that was registered when the peer sent its file-request.
 *
 * If the transfer is a file-complete or file-error, the stream is closed after sending.
 *
 * TODO: stream.send() backpressure is not handled. Large files (>10MB) may
 * overflow the stream write buffer, causing stream resets. Needs flow control
 * between main process chunk dispatch and utility process stream writes.
 * See: https://github.com/libp2p/js-libp2p/blob/main/doc/migrations/v1.0.0-v2.0.0.md#streams
 */
export async function sendFileChunk(
    libp2p: Libp2p,
    peerId: PeerId,
    message: FileTransferMessage
): Promise<void> {
    const sha256 = 'sha256' in message ? message.sha256 : ''
    const key = serveKey(peerId.toString(), sha256)
    const stream = activeServeStreams.get(key)

    if (!stream) {
        console.warn(`[FileTransfer] No active serve stream for ${peerId.toString().slice(0, 12)}:${sha256.slice(0, 8)}... — dropping message type=${message.type}`)
        return
    }

    try {
        stream.send(encodeFramed(message))

        if (message.type === 'file-complete' || message.type === 'file-error') {
            activeServeStreams.delete(key)
            try { await stream.close() } catch { /* ignore */ }
        }
    } catch (err) {
        console.error(`[FileTransfer] Error writing to serve stream: ${err}`)
        activeServeStreams.delete(key)
        try { await stream.close() } catch { /* ignore */ }
        throw err
    }
}

/**
 * Cancel an in-progress transfer with a peer.
 *
 * Sends transfer-cancel on a new short-lived stream (cancel can be sent at any time,
 * independent of whether the file stream is still open).
 * Also tears down any locally registered streams for this transfer.
 */
export async function cancelTransfer(
    libp2p: Libp2p,
    peerId: PeerId,
    sha256: string
): Promise<void> {
    const shortId = peerId.toString().slice(0, 12)
    console.log(`[FileTransfer] Cancelling transfer ${sha256.slice(0, 8)}... with ${shortId}`)

    const key = serveKey(peerId.toString(), sha256)

    // Clean up local stream registries
    const serveStream = activeServeStreams.get(key)
    if (serveStream) {
        activeServeStreams.delete(key)
        try { await serveStream.close() } catch { /* ignore */ }
    }

    const receiveStream = activeReceiveStreams.get(key)
    if (receiveStream) {
        activeReceiveStreams.delete(key)
        try { await receiveStream.close() } catch { /* ignore */ }
    }

    // Notify the remote peer
    try {
        const stream = await libp2p.dialProtocol(peerId, PROTOCOL)
        const msg: FileTransferMessage = { type: 'transfer-cancel', sha256 }
        stream.send(encodeFramed(msg))
        try { await stream.close() } catch { /* ignore */ }
    } catch (err) {
        // Non-fatal — if the peer is gone, cancel is moot
        console.warn(`[FileTransfer] Could not send cancel to ${shortId}: ${err}`)
    }
}
