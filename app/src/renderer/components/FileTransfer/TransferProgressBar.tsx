/**
 * TransferProgressBar
 *
 * Two exported components:
 *  - TransferProgressItem  — single transfer row with progress bar + cancel
 *  - TransferProgressAggregate — playlist-scoped aggregate with expand/collapse
 */

import { useState } from 'react'
import type { ActiveTransfer } from '../../../shared/core/file-transfer-types'
import { useFileTransferStatus } from '../../hooks/useFileTransfer'
import { useFileTransferStore } from '../../stores/file-transfer-store'

// ----------------------------------------------------------------
// Utility
// ----------------------------------------------------------------

function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B'
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`
    if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MB`
    return `${(bytes / 1073741824).toFixed(1)} GB`
}

// ----------------------------------------------------------------
// TransferProgressItem
// ----------------------------------------------------------------

export interface TransferProgressItemProps {
    transfer: ActiveTransfer
    onCancel: (sha256: string) => void
}

const STATUS_BAR_COLOR: Record<ActiveTransfer['status'], string> = {
    pending: 'bg-surface-high',
    transferring: 'bg-primary',
    verifying: 'bg-primary',
    complete: 'bg-green-500',
    error: 'bg-red-500',
    cancelled: 'bg-surface-high',
}

const STATUS_LABEL: Record<ActiveTransfer['status'], string> = {
    pending: 'Pending',
    transferring: 'Downloading',
    verifying: 'Verifying',
    complete: 'Done',
    error: 'Error',
    cancelled: 'Cancelled',
}

export function TransferProgressItem({ transfer, onCancel }: TransferProgressItemProps) {
    const pct =
        transfer.totalBytes > 0
            ? Math.min(100, Math.round((transfer.bytesReceived / transfer.totalBytes) * 100))
            : 0

    const isActive =
        transfer.status === 'pending' ||
        transfer.status === 'transferring' ||
        transfer.status === 'verifying'

    const barColor = STATUS_BAR_COLOR[transfer.status]

    return (
        <div className="space-y-1">
            <div className="flex items-center justify-between gap-2">
                <span
                    className="text-xs text-on-surface truncate flex-1"
                    title={transfer.filename}
                >
                    {transfer.filename}
                </span>
                <span className="text-[10px] text-on-surface-variant shrink-0">
                    {STATUS_LABEL[transfer.status]}
                </span>
                {isActive && (
                    <button
                        onClick={() => onCancel(transfer.sha256)}
                        className="text-[10px] text-on-surface-variant hover:text-error transition-colors shrink-0"
                        aria-label="Cancel transfer"
                    >
                        Cancel
                    </button>
                )}
            </div>

            {/* Progress bar */}
            <div className="w-full bg-surface-high rounded-full h-1.5 overflow-hidden">
                <div
                    className={`h-full rounded-full transition-all duration-200 ${barColor}`}
                    style={{ width: `${pct}%` }}
                />
            </div>

            <div className="flex items-center justify-between">
                {transfer.status === 'error' ? (
                    <span className="text-[10px] text-error">{transfer.error ?? 'Unknown error'}</span>
                ) : (
                    <span className="text-[10px] text-on-surface-variant">
                        {formatBytes(transfer.bytesReceived)} / {formatBytes(transfer.totalBytes)}
                    </span>
                )}
                {transfer.status !== 'error' && (
                    <span className="text-[10px] text-on-surface-variant">{pct}%</span>
                )}
            </div>
        </div>
    )
}

// ----------------------------------------------------------------
// TransferProgressAggregate
// ----------------------------------------------------------------

export interface TransferProgressAggregateProps {
    playlistId?: string
    onCancel: (sha256: string) => void
}

export function TransferProgressAggregate({
    playlistId,
    onCancel,
}: TransferProgressAggregateProps) {
    const [expanded, setExpanded] = useState(false)

    const status = useFileTransferStatus(playlistId)
    const transfers = useFileTransferStore((s) => s.transfers)
    const manifests = useFileTransferStore((s) => s.manifests)

    if (status.totalFiles === 0) return null

    const overallPct =
        status.totalBytes > 0
            ? Math.min(100, Math.round((status.bytesReceived / status.totalBytes) * 100))
            : 0

    // Filter to the same scope as useFileTransferStatus.
    // When playlistId is provided, restrict to transfers whose trackId belongs
    // to that playlist's manifest (plus the playlist cover-art entry).
    // Falls back to all transfers when no playlistId or no manifest yet.
    const relevantTransfers = (() => {
        if (!playlistId) return [...transfers.values()]
        const manifest = manifests.get(playlistId)
        if (!manifest) return [...transfers.values()]
        const trackIds = new Set(manifest.files.map((f) => f.trackId))
        trackIds.add(playlistId) // cover-art entry uses playlistId as trackId
        return [...transfers.values()].filter((t) => trackIds.has(t.trackId))
    })()

    const activeTransfers = relevantTransfers.filter(
        (t) =>
            t.status === 'pending' ||
            t.status === 'transferring' ||
            t.status === 'verifying' ||
            t.status === 'complete' ||
            t.status === 'error',
    )

    const hasActive = status.activeDownloads > 0

    return (
        <div className="card card-body space-y-3">
            {/* Summary row */}
            <button
                onClick={() => setExpanded((v) => !v)}
                className="flex items-center justify-between w-full gap-3"
            >
                <div className="flex-1 space-y-1 text-left">
                    <div className="flex items-center gap-2">
                        {hasActive && (
                            <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                        )}
                        <span className="text-xs font-medium text-on-surface">
                            {hasActive
                                ? `Downloading ${status.completedFiles}/${status.totalFiles} files`
                                : `${status.completedFiles}/${status.totalFiles} files downloaded`}
                        </span>
                        {status.totalBytes > 0 && (
                            <span className="text-[10px] text-on-surface-variant">
                                {formatBytes(status.bytesReceived)} / {formatBytes(status.totalBytes)}
                            </span>
                        )}
                        {status.hasErrors && (
                            <span className="text-[10px] text-error">· errors</span>
                        )}
                    </div>

                    <div className="w-full bg-surface-high rounded-full h-1 overflow-hidden">
                        <div
                            className={`h-full rounded-full transition-all duration-300 ${
                                status.hasErrors ? 'bg-red-500' : 'bg-primary'
                            }`}
                            style={{ width: `${overallPct}%` }}
                        />
                    </div>
                </div>
                <span className="text-[10px] text-on-surface-variant shrink-0">
                    {expanded ? 'Hide' : 'Show'} details
                </span>
            </button>

            {/* Expanded individual transfers */}
            {expanded && activeTransfers.length > 0 && (
                <div className="space-y-3 pt-2 border-t border-outline-variant">
                    {activeTransfers.map((t) => (
                        <TransferProgressItem key={t.sha256} transfer={t} onCancel={onCancel} />
                    ))}
                </div>
            )}
        </div>
    )
}
