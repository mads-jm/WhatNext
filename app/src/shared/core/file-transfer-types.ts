/**
 * File Transfer Type Definitions
 *
 * Shared types for the P2P file transfer system.
 * Used by: main process (transfer coordinator), renderer (UI state), utility process (P2P layer).
 *
 * This file has no imports — it is environment-agnostic and dependency-free.
 */

// ========================================
// Capability String
// ========================================

/**
 * Capability string advertised during P2P handshake to signal file transfer support.
 * Peers that include this in their capabilities list can participate in file transfers.
 */
export const FILE_TRANSFER_CAPABILITY = 'file-transfer/1.0.0'

// ========================================
// Configuration Constants
// ========================================

export const FILE_TRANSFER_CONFIG = {
    /** libp2p protocol identifier for the file transfer stream */
    PROTOCOL_ID: '/whatnext/file-transfer/1.0.0',

    /** Chunk size for streaming file data over the wire (64KB) */
    CHUNK_SIZE: 65536,

    /** Maximum file size the system will accept (500MB) */
    MAX_FILE_SIZE: 524288000,

    /** Maximum simultaneous audio file downloads */
    MAX_CONCURRENT_AUDIO: 1,

    /** Maximum simultaneous artwork downloads */
    MAX_CONCURRENT_ARTWORK: 3,

    /** Hash algorithm used for integrity verification and deduplication */
    HASH_ALGORITHM: 'sha256',

    /** Subdirectory name for in-progress downloads within the audio storage path */
    PARTIAL_DIR: '.partial',

    /** Filename for persisted transfer state (resume across restarts) */
    TRANSFER_STATE_FILE: 'transfers.json',
} as const

// ========================================
// File Entry
// ========================================

/**
 * Describes a single file available in a peer's manifest.
 * The sha256 is the deduplication key — peers can skip requesting
 * files they already have locally (content-addressable lookup).
 */
export interface FileEntry {
    /** RxDB track ID, or playlistId when type === 'cover-art' */
    trackId: string

    type: 'audio' | 'artwork' | 'cover-art'

    /** SHA-256 content hash (hex) — used for dedup and integrity verification */
    sha256: string

    sizeBytes: number

    /** MIME type, e.g. 'audio/mpeg', 'image/jpeg' */
    mimeType: string

    /** Display filename — not used to derive disk paths on the receiving end */
    filename: string

    // Audio-specific fields (only populated when type === 'audio')

    /** Codec identifier, e.g. 'mp3' | 'opus' | 'aac' | 'flac' | 'wav' */
    audioFormat?: string

    /** Encoding bitrate in kbps */
    audioBitrate?: number
}

// ========================================
// File Manifest
// ========================================

/**
 * A peer's declaration of what files it has available for a given playlist.
 * Sent in response to a manifest-request message.
 */
export interface FileManifest {
    /** libp2p peer ID of the sender */
    peerId: string

    playlistId: string

    files: FileEntry[]

    /** ISO timestamp — allows receivers to detect stale manifests */
    generatedAt: string
}

// ========================================
// Wire Protocol Messages
// ========================================

/**
 * Discriminated union of all messages exchanged over the file-transfer stream.
 *
 * Flow (happy path):
 *   requester                          provider
 *       |--- manifest-request --------->|
 *       |<-- manifest-response ---------|
 *       |--- file-request (sha256) ---->|
 *       |<-- file-header ---------------|
 *       |<-- file-chunk (×N) -----------|
 *       |<-- file-complete -------------|
 *
 * Either side may send transfer-cancel at any point.
 * Provider sends file-error if it cannot serve the file.
 */
export type FileTransferMessage =
    | {
          type: 'manifest-request'
          playlistId: string
      }
    | {
          type: 'manifest-response'
          manifest: FileManifest
      }
    | {
          /** offsetBytes enables resume — set to 0 for a fresh request */
          type: 'file-request'
          sha256: string
          offsetBytes: number
      }
    | {
          type: 'file-header'
          sha256: string
          totalBytes: number
          chunkSize: number
      }
    | {
          /** data is base64-encoded for JSON transport */
          type: 'file-chunk'
          sha256: string
          offset: number
          data: string
      }
    | {
          type: 'file-complete'
          sha256: string
      }
    | {
          type: 'file-error'
          sha256: string
          error: string
      }
    | {
          type: 'transfer-cancel'
          sha256: string
      }

// ========================================
// Transfer State
// ========================================

/**
 * Tracks the runtime state of a single active or recently-completed transfer.
 * Persisted to TRANSFER_STATE_FILE for resume-across-restart support.
 */
export interface ActiveTransfer {
    sha256: string

    /** RxDB track ID (or playlistId for cover-art) */
    trackId: string

    type: 'audio' | 'artwork' | 'cover-art'

    filename: string

    totalBytes: number

    bytesReceived: number

    status: 'pending' | 'transferring' | 'verifying' | 'complete' | 'error' | 'cancelled'

    /** libp2p peer ID we are downloading from */
    peerId: string

    /** ISO timestamp when the transfer was initiated */
    startedAt: string

    /** Populated when status === 'error' */
    error?: string
}

// ========================================
// IPC Event Payloads (main → renderer)
// ========================================

/**
 * Emitted repeatedly during an active transfer to drive progress UI.
 */
export interface TransferProgress {
    sha256: string
    trackId: string
    bytesReceived: number
    totalBytes: number
    bytesPerSecond: number
}

/**
 * Emitted once when a transfer reaches 'complete' status and the file is
 * available at localFilePath.
 */
export interface TransferComplete {
    sha256: string
    trackId: string
    type: 'audio' | 'artwork' | 'cover-art'
    /** Absolute path to the written file on disk */
    localFilePath: string
}

/**
 * Emitted when a transfer fails unrecoverably.
 */
export interface TransferError {
    sha256: string
    trackId: string
    error: string
}
