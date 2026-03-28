/**
 * WhatNext Test Peer — File Transfer Store
 *
 * In-memory store for test files (served to peers) and active transfer tracking.
 * Test files are generated with random content on startup so we always have
 * something to offer without needing real audio/image assets.
 */

import crypto from 'node:crypto';

// ─── MIME helpers ─────────────────────────────────────────────────────────────

/**
 * Guess MIME type from filename extension.
 *
 * @param {string} filename
 * @returns {string}
 */
export function guessMimeType(filename) {
    const ext = filename.split('.').pop()?.toLowerCase() ?? '';
    const map = {
        mp3: 'audio/mpeg',
        opus: 'audio/opus',
        ogg: 'audio/ogg',
        aac: 'audio/aac',
        flac: 'audio/flac',
        wav: 'audio/wav',
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        png: 'image/png',
        webp: 'image/webp',
    };
    return map[ext] ?? 'application/octet-stream';
}

// ─── Test file store ──────────────────────────────────────────────────────────

/**
 * sha256 (hex) → { sha256, data: Buffer, filename, sizeBytes, mimeType, type }
 * @type {Map<string, object>}
 */
const testFiles = new Map();

/**
 * Add a file to the test store. Returns the sha256 hash.
 *
 * @param {string} name
 * @param {Buffer|string} content
 * @returns {string} sha256 hex
 */
export function addTestFile(name, content) {
    const buf = Buffer.isBuffer(content) ? content : Buffer.from(content);
    const sha256 = crypto.createHash('sha256').update(buf).digest('hex');

    const ext = name.split('.').pop()?.toLowerCase() ?? '';
    const isImage = ['jpg', 'jpeg', 'png', 'webp'].includes(ext);

    testFiles.set(sha256, {
        sha256,
        data: buf,
        filename: name,
        sizeBytes: buf.length,
        mimeType: guessMimeType(name),
        type: isImage ? 'artwork' : 'audio',
        trackId: `test-${sha256.slice(0, 8)}`,
    });

    return sha256;
}

/**
 * Retrieve a test file by sha256.
 *
 * @param {string} sha256
 * @returns {object|undefined}
 */
export function getTestFile(sha256) {
    return testFiles.get(sha256);
}

/**
 * Return all test files as an array.
 *
 * @returns {object[]}
 */
export function getAllTestFiles() {
    return Array.from(testFiles.values());
}

// ─── Active transfer registry ─────────────────────────────────────────────────

/**
 * sha256 → { sha256, filename, totalBytes, bytesReceived, status, peerId, startedAt, chunks: Buffer[] }
 * Tracks downloads (files we are receiving from peers).
 * @type {Map<string, object>}
 */
const activeTransfers = new Map();

/**
 * Start tracking a download.
 *
 * @param {string} sha256
 * @param {string} filename
 * @param {number} totalBytes
 * @param {string} peerId
 */
export function startTransfer(sha256, filename, totalBytes, peerId) {
    activeTransfers.set(sha256, {
        sha256,
        filename,
        totalBytes,
        bytesReceived: 0,
        status: 'transferring',
        peerId,
        startedAt: new Date().toISOString(),
        chunks: [],
    });
}

/**
 * Record an incoming chunk.
 *
 * @param {string} sha256
 * @param {number} offset
 * @param {Buffer} chunkBuf
 * @returns {boolean} false if transfer not found
 */
export function recordChunk(sha256, offset, chunkBuf) {
    const t = activeTransfers.get(sha256);
    if (!t) return false;
    t.chunks.push({ offset, data: chunkBuf });
    t.bytesReceived += chunkBuf.length;
    return true;
}

/**
 * Mark a transfer complete. Returns the assembled Buffer or null if not found.
 *
 * @param {string} sha256
 * @returns {{ buf: Buffer, filename: string }|null}
 */
export function completeTransfer(sha256) {
    const t = activeTransfers.get(sha256);
    if (!t) return null;

    // Sort chunks by offset and assemble
    t.chunks.sort((a, b) => a.offset - b.offset);
    const buf = Buffer.concat(t.chunks.map(c => c.data));
    t.status = 'complete';
    t.completedAt = new Date().toISOString();

    return { buf, filename: t.filename };
}

/**
 * Mark a transfer as errored.
 *
 * @param {string} sha256
 * @param {string} error
 */
export function failTransfer(sha256, error) {
    const t = activeTransfers.get(sha256);
    if (t) {
        t.status = 'error';
        t.error = error;
    }
}

/**
 * Cancel a transfer.
 *
 * @param {string} sha256
 */
export function cancelTransferRecord(sha256) {
    const t = activeTransfers.get(sha256);
    if (t) t.status = 'cancelled';
}

/**
 * Remove a transfer record entirely.
 *
 * @param {string} sha256
 */
export function removeTransfer(sha256) {
    activeTransfers.delete(sha256);
}

/**
 * Return all active (non-complete, non-cancelled) transfers.
 *
 * @returns {object[]}
 */
export function getActiveTransfers() {
    return Array.from(activeTransfers.values());
}

// ─── Seed files ───────────────────────────────────────────────────────────────

// Create two small test files on module load so the peer always has something to offer.
addTestFile('test-track.mp3', crypto.randomBytes(256 * 1024));  // 256KB fake audio
addTestFile('cover.jpg', crypto.randomBytes(32 * 1024));        // 32KB fake artwork
