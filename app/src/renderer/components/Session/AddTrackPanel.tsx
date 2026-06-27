/**
 * AddTrackPanel
 * Session-level "Add track" affordance for the Manual TrackSource (#37).
 *
 * Two inputs, one sink: a hand-typed entry (title/artists/album/duration) or a
 * pick from the local library (`searchTracks`). Both are normalized to an
 * `IncomingTrack` and handed to `onAdd`, which routes through the shared
 * `useTrackSource` add path → `addIncomingTrack`. The panel is rendered only
 * for manual sessions (SessionView gates on a non-null `addTrack`), so the
 * session/feed/turn layers stay source-agnostic.
 */

import { useState } from 'react';
import { searchTracks } from '../../db/services/track-service';
import type { TrackDocument } from '../../db/schemas';
import type { IncomingTrack } from '../../../shared/session-interfaces';

interface AddTrackPanelProps {
    /** Routes an IncomingTrack through the shared sink. Returns once persisted. */
    onAdd: (incoming: IncomingTrack) => Promise<void>;
    /** Last add error surfaced by the source hook, if any. */
    error?: string | null;
}

type Mode = 'manual' | 'library';

/**
 * Parse a "m:ss", "h:mm:ss", or plain-seconds duration string to milliseconds.
 * Returns 0 for empty/unparseable input (duration is non-critical metadata).
 */
function parseDurationToMs(raw: string): number {
    const trimmed = raw.trim();
    if (!trimmed) return 0;
    if (!trimmed.includes(':')) {
        const secs = Number(trimmed);
        return Number.isFinite(secs) && secs >= 0 ? Math.round(secs * 1000) : 0;
    }
    const parts = trimmed.split(':').map((p) => Number(p));
    if (parts.some((n) => !Number.isFinite(n) || n < 0)) return 0;
    const seconds = parts.reduce((acc, n) => acc * 60 + n, 0);
    return Math.round(seconds * 1000);
}

export function AddTrackPanel({ onAdd, error }: AddTrackPanelProps) {
    const [open, setOpen] = useState(false);
    const [mode, setMode] = useState<Mode>('manual');
    const [submitting, setSubmitting] = useState(false);

    // Manual-entry form state
    const [title, setTitle] = useState('');
    const [artists, setArtists] = useState('');
    const [album, setAlbum] = useState('');
    const [duration, setDuration] = useState('');

    // Library-search state
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<TrackDocument[]>([]);
    const [searching, setSearching] = useState(false);

    const resetForm = () => {
        setTitle('');
        setArtists('');
        setAlbum('');
        setDuration('');
    };

    const handleManualSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!title.trim() || submitting) return;
        setSubmitting(true);
        try {
            await onAdd({
                title: title.trim(),
                artists: artists
                    .split(',')
                    .map((a) => a.trim())
                    .filter(Boolean),
                album: album.trim(),
                durationMs: parseDurationToMs(duration),
                externalSource: 'manual',
                addedAt: new Date().toISOString(),
            });
            resetForm();
        } catch {
            // Error surfaced via the `error` prop from the source hook.
        } finally {
            setSubmitting(false);
        }
    };

    const handleSearch = async (e: React.FormEvent) => {
        e.preventDefault();
        const q = query.trim();
        if (!q) {
            setResults([]);
            return;
        }
        setSearching(true);
        try {
            const docs = await (await searchTracks(q)).exec();
            setResults(docs);
        } finally {
            setSearching(false);
        }
    };

    const handleAddFromLibrary = async (track: TrackDocument) => {
        if (submitting) return;
        setSubmitting(true);
        try {
            await onAdd({
                title: track.title,
                artists: track.artists,
                album: track.album,
                durationMs: track.durationMs,
                externalId: track.spotifyId,
                externalSource: track.source ?? 'local',
                albumArtUrl: track.albumArtUrl,
                localFilePath: track.localFilePath,
                addedAt: new Date().toISOString(),
            });
        } catch {
            // Error surfaced via the `error` prop from the source hook.
        } finally {
            setSubmitting(false);
        }
    };

    if (!open) {
        return (
            <button
                className="btn-primary w-full"
                onClick={() => setOpen(true)}
                data-testid="add-track-open"
            >
                + Add track
            </button>
        );
    }

    return (
        <div className="card card-body space-y-3" data-testid="add-track-panel">
            <div className="flex items-center justify-between">
                <div className="flex gap-2">
                    <button
                        className={
                            mode === 'manual'
                                ? 'btn-ghost text-sm border border-outline-variant'
                                : 'btn-ghost text-sm'
                        }
                        onClick={() => setMode('manual')}
                    >
                        Manual
                    </button>
                    <button
                        className={
                            mode === 'library'
                                ? 'btn-ghost text-sm border border-outline-variant'
                                : 'btn-ghost text-sm'
                        }
                        onClick={() => setMode('library')}
                    >
                        Library
                    </button>
                </div>
                <button
                    className="btn-ghost text-sm"
                    onClick={() => setOpen(false)}
                    aria-label="Close add-track panel"
                >
                    Done
                </button>
            </div>

            {mode === 'manual' ? (
                <form onSubmit={handleManualSubmit} className="space-y-2">
                    <input
                        className="input text-sm w-full"
                        placeholder="Title (required)"
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        aria-label="Track title"
                    />
                    <input
                        className="input text-sm w-full"
                        placeholder="Artist(s), comma-separated"
                        value={artists}
                        onChange={(e) => setArtists(e.target.value)}
                        aria-label="Artists"
                    />
                    <input
                        className="input text-sm w-full"
                        placeholder="Album"
                        value={album}
                        onChange={(e) => setAlbum(e.target.value)}
                        aria-label="Album"
                    />
                    <input
                        className="input text-sm w-full"
                        placeholder="Duration (m:ss or seconds)"
                        value={duration}
                        onChange={(e) => setDuration(e.target.value)}
                        aria-label="Duration"
                    />
                    <button
                        type="submit"
                        className="btn-primary w-full"
                        disabled={!title.trim() || submitting}
                    >
                        {submitting ? 'Adding…' : 'Add to session'}
                    </button>
                </form>
            ) : (
                <div className="space-y-2">
                    <form onSubmit={handleSearch} className="flex gap-2">
                        <input
                            className="input text-sm w-full"
                            placeholder="Search local library…"
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            aria-label="Search library"
                        />
                        <button type="submit" className="btn-ghost text-sm" disabled={searching}>
                            {searching ? '…' : 'Search'}
                        </button>
                    </form>
                    <ul className="space-y-1 max-h-48 overflow-y-auto">
                        {results.map((track) => (
                            <li key={track.id}>
                                <button
                                    className="btn-ghost text-sm w-full text-left"
                                    onClick={() => handleAddFromLibrary(track)}
                                    disabled={submitting}
                                >
                                    {track.title}
                                    {track.artists.length > 0
                                        ? ` — ${track.artists.join(', ')}`
                                        : ''}
                                </button>
                            </li>
                        ))}
                        {!searching && query.trim() && results.length === 0 && (
                            <li className="text-xs text-on-surface-variant px-1">
                                No matching tracks in your library.
                            </li>
                        )}
                    </ul>
                </div>
            )}

            {error && (
                <p className="text-xs text-error" role="alert">
                    {error}
                </p>
            )}
        </div>
    );
}
