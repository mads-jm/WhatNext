/**
 * FileManifestPanel
 *
 * Displays files available from a peer's manifest, grouped by type,
 * with checkbox selection and a "Download Selected" action.
 */

import { useState, useMemo } from 'react';
import type {
    FileEntry,
    FileManifest,
} from '../../../shared/core/file-transfer-types';

// ----------------------------------------------------------------
// Utility
// ----------------------------------------------------------------

function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MB`;
    return `${(bytes / 1073741824).toFixed(1)} GB`;
}

// ----------------------------------------------------------------
// Sub-component: FileRow
// ----------------------------------------------------------------

interface FileRowProps {
    entry: FileEntry;
    checked: boolean;
    alreadyHave: boolean;
    onChange: (sha256: string, checked: boolean) => void;
}

function FileRow({ entry, checked, alreadyHave, onChange }: FileRowProps) {
    const typeLabel =
        entry.type === 'audio'
            ? entry.audioFormat
                ? entry.audioFormat.toUpperCase()
                : 'Audio'
            : entry.type === 'artwork'
              ? 'Art'
              : 'Cover';

    return (
        <label
            className={`flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer transition-colors
                ${alreadyHave ? 'opacity-50 cursor-not-allowed' : 'hover:bg-surface-high'}`}
        >
            <input
                type="checkbox"
                className="accent-primary"
                checked={alreadyHave ? false : checked}
                disabled={alreadyHave}
                onChange={(e) => onChange(entry.sha256, e.target.checked)}
            />
            <span
                className="flex-1 text-xs text-on-surface truncate"
                title={entry.filename}
            >
                {entry.filename}
            </span>
            {entry.audioBitrate && (
                <span className="text-[10px] text-on-surface-variant shrink-0">
                    {entry.audioBitrate}kbps
                </span>
            )}
            <span className="text-[10px] text-on-surface-variant bg-surface-high rounded px-1.5 py-0.5 shrink-0">
                {typeLabel}
            </span>
            <span className="text-[10px] text-on-surface-variant shrink-0 w-16 text-right">
                {alreadyHave ? 'Have it' : formatBytes(entry.sizeBytes)}
            </span>
        </label>
    );
}

// ----------------------------------------------------------------
// Sub-component: FileGroup
// ----------------------------------------------------------------

interface FileGroupProps {
    label: string;
    entries: FileEntry[];
    selected: Set<string>;
    existingHashes: Set<string>;
    onToggle: (sha256: string, checked: boolean) => void;
}

function FileGroup({
    label,
    entries,
    selected,
    existingHashes,
    onToggle,
}: FileGroupProps) {
    const [open, setOpen] = useState(true);
    if (entries.length === 0) return null;

    return (
        <div className="space-y-1">
            <button
                onClick={() => setOpen((v) => !v)}
                className="flex items-center gap-2 w-full text-left px-1 py-1 text-xs font-semibold text-on-surface-variant hover:text-on-surface transition-colors"
            >
                <span
                    className={`transition-transform ${open ? 'rotate-90' : ''}`}
                >
                    ›
                </span>
                {label}
                <span className="font-normal text-[10px]">
                    ({entries.length})
                </span>
            </button>
            {open && (
                <div className="space-y-0.5">
                    {entries.map((entry) => (
                        <FileRow
                            key={entry.sha256}
                            entry={entry}
                            checked={selected.has(entry.sha256)}
                            alreadyHave={existingHashes.has(entry.sha256)}
                            onChange={onToggle}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}

// ----------------------------------------------------------------
// Main component
// ----------------------------------------------------------------

export interface FileManifestPanelProps {
    manifest: FileManifest;
    onRequestFiles: (files: FileEntry[]) => void;
    existingHashes?: Set<string>;
}

export function FileManifestPanel({
    manifest,
    onRequestFiles,
    existingHashes = new Set(),
}: FileManifestPanelProps) {
    const [selected, setSelected] = useState<Set<string>>(new Set());

    const audioFiles = useMemo(
        () => manifest.files.filter((f) => f.type === 'audio'),
        [manifest.files],
    );
    const artworkFiles = useMemo(
        () => manifest.files.filter((f) => f.type === 'artwork'),
        [manifest.files],
    );
    const coverFiles = useMemo(
        () => manifest.files.filter((f) => f.type === 'cover-art'),
        [manifest.files],
    );

    const availableFiles = useMemo(
        () => manifest.files.filter((f) => !existingHashes.has(f.sha256)),
        [manifest.files, existingHashes],
    );

    const allAvailableSelected =
        availableFiles.length > 0 &&
        availableFiles.every((f) => selected.has(f.sha256));

    const toggleAll = () => {
        if (allAvailableSelected) {
            setSelected(new Set());
        } else {
            setSelected(new Set(availableFiles.map((f) => f.sha256)));
        }
    };

    const handleToggle = (sha256: string, checked: boolean) => {
        setSelected((prev) => {
            const next = new Set(prev);
            if (checked) {
                next.add(sha256);
            } else {
                next.delete(sha256);
            }
            return next;
        });
    };

    const handleDownload = () => {
        const toDownload = manifest.files.filter((f) => selected.has(f.sha256));
        if (toDownload.length === 0) return;
        onRequestFiles(toDownload);
    };

    const selectedBytes = useMemo(() => {
        return manifest.files
            .filter((f) => selected.has(f.sha256))
            .reduce((sum, f) => sum + f.sizeBytes, 0);
    }, [manifest.files, selected]);

    if (manifest.files.length === 0) {
        return (
            <div className="card card-body">
                <p className="text-xs text-on-surface-variant text-center py-4">
                    This peer has no files available for this playlist.
                </p>
            </div>
        );
    }

    return (
        <div className="card card-body space-y-3">
            <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-on-surface">
                    Peer Files
                </h3>
                <span className="text-[10px] text-on-surface-variant">
                    from {manifest.peerId.slice(0, 12)}…
                </span>
            </div>

            {/* Select all toggle */}
            <div className="flex items-center justify-between pb-1 border-b border-outline-variant">
                <button
                    onClick={toggleAll}
                    disabled={availableFiles.length === 0}
                    className="text-xs text-primary hover:text-primary-dim disabled:opacity-40 transition-colors"
                >
                    {allAvailableSelected ? 'Deselect All' : 'Select All'}
                </button>
                <span className="text-[10px] text-on-surface-variant">
                    {availableFiles.length} available
                    {existingHashes.size > 0 &&
                        `, ${manifest.files.length - availableFiles.length} already downloaded`}
                </span>
            </div>

            {/* Grouped file list */}
            <div className="space-y-2">
                <FileGroup
                    label="Audio"
                    entries={audioFiles}
                    selected={selected}
                    existingHashes={existingHashes}
                    onToggle={handleToggle}
                />
                <FileGroup
                    label="Artwork"
                    entries={artworkFiles}
                    selected={selected}
                    existingHashes={existingHashes}
                    onToggle={handleToggle}
                />
                <FileGroup
                    label="Cover Art"
                    entries={coverFiles}
                    selected={selected}
                    existingHashes={existingHashes}
                    onToggle={handleToggle}
                />
            </div>

            {/* Download action */}
            <div className="flex items-center justify-between pt-2 border-t border-outline-variant">
                <span className="text-xs text-on-surface-variant">
                    {selected.size > 0
                        ? `${selected.size} selected · ${formatBytes(selectedBytes)}`
                        : 'No files selected'}
                </span>
                <button
                    onClick={handleDownload}
                    disabled={selected.size === 0}
                    className="px-4 py-2 bg-primary hover:bg-primary-dim disabled:bg-surface-high disabled:text-on-surface-variant text-on-surface text-xs rounded-lg transition-colors"
                >
                    Download Selected
                </button>
            </div>
        </div>
    );
}
