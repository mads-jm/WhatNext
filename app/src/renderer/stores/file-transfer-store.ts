/**
 * Zustand File Transfer Store
 *
 * Holds runtime state for P2P file transfers:
 *   - Active/completed transfers keyed by sha256
 *   - Received manifests keyed by playlistId
 *   - Per-playlist sharing toggle
 *   - Peer capability map (populated from handshake events)
 */

import { create } from 'zustand'
import type { ActiveTransfer, FileManifest } from '../../shared/core/file-transfer-types'

interface FileTransferState {
    // State
    transfers: Map<string, ActiveTransfer>
    manifests: Map<string, FileManifest>
    sharingEnabled: Map<string, boolean>
    peerCapabilities: Map<string, string[]>

    // Actions
    updateTransfer: (sha256: string, update: Partial<ActiveTransfer>) => void
    setManifest: (playlistId: string, manifest: FileManifest) => void
    removeTransfer: (sha256: string) => void
    setSharingEnabled: (playlistId: string, enabled: boolean) => void
    clearPlaylistTransfers: (trackIds: Set<string>) => void
    setPeerCapabilities: (peerId: string, capabilities: string[]) => void
}

export const useFileTransferStore = create<FileTransferState>((set) => ({
    transfers: new Map(),
    manifests: new Map(),
    sharingEnabled: new Map(),
    peerCapabilities: new Map(),

    updateTransfer: (sha256, update) =>
        set((state) => {
            const next = new Map(state.transfers)
            const existing = next.get(sha256)
            if (existing) {
                next.set(sha256, { ...existing, ...update })
            } else {
                // If there's no existing entry, only insert if the update has enough fields
                // to form a valid ActiveTransfer — callers are responsible for that.
                next.set(sha256, update as ActiveTransfer)
            }
            return { transfers: next }
        }),

    setManifest: (playlistId, manifest) =>
        set((state) => {
            const next = new Map(state.manifests)
            next.set(playlistId, manifest)
            return { manifests: next }
        }),

    removeTransfer: (sha256) =>
        set((state) => {
            const next = new Map(state.transfers)
            next.delete(sha256)
            return { transfers: next }
        }),

    setSharingEnabled: (playlistId, enabled) =>
        set((state) => {
            const next = new Map(state.sharingEnabled)
            next.set(playlistId, enabled)
            return { sharingEnabled: next }
        }),

    clearPlaylistTransfers: (trackIds) =>
        set((state) => {
            const next = new Map(state.transfers)
            for (const [sha256, transfer] of next) {
                if (trackIds.has(transfer.trackId)) {
                    next.delete(sha256)
                }
            }
            return { transfers: next }
        }),

    setPeerCapabilities: (peerId, capabilities) =>
        set((state) => {
            const next = new Map(state.peerCapabilities)
            next.set(peerId, capabilities)
            return { peerCapabilities: next }
        }),
}))
