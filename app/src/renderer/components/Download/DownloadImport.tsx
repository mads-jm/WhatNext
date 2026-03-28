/**
 * DownloadImport — top-level download view with three tabs:
 *   URL Import  |  Library Download (Phase D)  |  Local Files
 *
 * The "Local Files" tab navigates to the existing localImport view.
 * The "Library Download" tab is a placeholder until Phase D.
 */

import { useState } from 'react';
import { useNavigationStore } from '../../stores/navigation-store';
import { DownloadDisclaimerModal, hasAcceptedDisclaimer } from './DownloadDisclaimerModal';
import { usePlaylistDownload } from '../../hooks/usePlaylistDownload';
import { BackendGate } from './BackendGate';
import { BackendPicker } from './BackendPicker';
import { DownloadTrackSelector } from './DownloadTrackSelector';
import { DownloadProgress } from './DownloadProgress';
import { DownloadComplete } from './DownloadComplete';
import { LibraryDownload } from './LibraryDownload';

type Tab = 'url' | 'library' | 'local';

export function DownloadImport() {
    const navigate = useNavigationStore((s) => s.navigate);
    const [activeTab, setActiveTab] = useState<Tab>('url');
    const [disclaimerAccepted, setDisclaimerAccepted] = useState(hasAcceptedDisclaimer);

    const dl = usePlaylistDownload();

    const hasAnyBackend = dl.backends.some((b) => b.installed);
    const isChecking = dl.state === 'checking';

    return (
        <>
        <DownloadDisclaimerModal
            open={!disclaimerAccepted}
            onAccept={() => setDisclaimerAccepted(true)}
        />
        <div className="flex flex-col gap-6 p-6 max-w-4xl">
            {/* Header */}
            <div>
                <h1 className="text-2xl font-extrabold font-headline text-on-surface tracking-tight">
                    Download &amp; Import
                </h1>
                <p className="text-sm text-on-surface-variant mt-1">
                    Download audio from YouTube, SoundCloud, Bandcamp, and more — or import from
                    your local files.
                </p>
            </div>

            {/* Tabs */}
            <div className="flex gap-1 border-b border-outline-variant/10">
                {([
                    { id: 'url', label: 'URL Import', icon: 'fa-solid fa-link' },
                    { id: 'library', label: 'Library Download', icon: 'fa-solid fa-cloud-arrow-down' },
                    { id: 'local', label: 'Local Files', icon: 'fa-solid fa-folder-open' },
                ] as { id: Tab; label: string; icon: string }[]).map((tab) => (
                    <button
                        key={tab.id}
                        onClick={() => {
                            if (tab.id === 'local') {
                                navigate('localImport');
                                return;
                            }
                            setActiveTab(tab.id);
                        }}
                        className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
                            activeTab === tab.id && tab.id !== 'local'
                                ? 'border-primary text-on-surface'
                                : 'border-transparent text-on-surface-variant hover:text-on-surface'
                        }`}
                    >
                        <i className={tab.icon} />
                        {tab.label}
                    </button>
                ))}
            </div>

            {/* Tab content */}
            {activeTab === 'url' && (
                <UrlTab dl={dl} hasAnyBackend={hasAnyBackend} isChecking={isChecking} />
            )}

            {activeTab === 'library' && (
                <LibraryDownload />
            )}
        </div>
        </>
    );
}

// ---------------------------------------------------------------------------
// URL Import tab
// ---------------------------------------------------------------------------

function UrlTab({
    dl,
    hasAnyBackend,
    isChecking,
}: {
    dl: ReturnType<typeof usePlaylistDownload>;
    hasAnyBackend: boolean;
    isChecking: boolean;
}) {
    if (isChecking) {
        return (
            <div className="flex items-center justify-center py-20 gap-3 text-on-surface-variant">
                <i className="fa-solid fa-spinner fa-spin" />
                <span className="text-sm">Checking installed backends…</span>
            </div>
        );
    }

    if (!hasAnyBackend) {
        return <BackendGate backends={dl.backends} />;
    }

    if (dl.state === 'idle' || dl.state === 'resolving') {
        return (
            <div className="flex flex-col gap-5">
                <BackendPicker
                    backends={dl.backends}
                    selected={dl.selectedBackend}
                    onChange={dl.setSelectedBackend}
                />

                {/* URL input */}
                <div className="flex flex-col gap-2">
                    <label htmlFor="url-input" className="text-xs uppercase tracking-widest text-on-surface-variant">
                        Paste a URL
                    </label>
                    <div className="flex gap-2">
                        <input
                            id="url-input"
                            type="url"
                            value={dl.url}
                            onChange={(e) => dl.setUrl(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && dl.resolveUrl()}
                            placeholder="https://youtube.com/playlist?list=… or track URL"
                            className="flex-1 bg-surface-high border border-outline-variant/20 rounded-xl px-4 py-2.5 text-sm text-on-surface placeholder:text-on-surface-variant focus:outline-none focus:border-primary/50"
                        />
                        <button
                            onClick={dl.resolveUrl}
                            disabled={!dl.url.trim() || dl.state === 'resolving'}
                            className="px-5 py-2.5 text-sm font-bold bg-gradient-to-r from-primary to-primary-dim text-surface rounded-xl hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity shrink-0"
                        >
                            {dl.state === 'resolving' ? (
                                <i className="fa-solid fa-spinner fa-spin" />
                            ) : (
                                'Resolve'
                            )}
                        </button>
                    </div>
                    <p className="text-xs text-on-surface-variant">
                        Supports YouTube, SoundCloud, Bandcamp, and{' '}
                        <button
                            onClick={() =>
                                window.electron?.shell.openExternal(
                                    'https://github.com/yt-dlp/yt-dlp/blob/master/supportedsites.md',
                                )
                            }
                            className="text-primary hover:underline"
                        >
                            1000+ more sites
                        </button>
                        .
                    </p>
                </div>

                {dl.error && <p className="text-sm text-error">{dl.error}</p>}
            </div>
        );
    }

    if (dl.state === 'selecting') {
        return (
            <DownloadTrackSelector
                tracks={dl.resolvedTracks}
                selectedIds={dl.selectedIds}
                preferredFormat={dl.preferredFormat}
                onToggle={dl.toggleTrack}
                onSelectAll={dl.selectAll}
                onSelectNone={dl.selectNone}
                onFormatChange={dl.setPreferredFormat}
                onConfirm={dl.startDownload}
                onBack={dl.reset}
            />
        );
    }

    if (dl.state === 'downloading') {
        return (
            <DownloadProgress
                tracks={dl.resolvedTracks.filter((t) => dl.selectedIds.has(t.sourceId))}
                progress={dl.progress}
                completedCount={dl.completedCount}
                onCancel={dl.cancel}
            />
        );
    }

    if (dl.state === 'done') {
        return (
            <DownloadComplete
                tracks={dl.resolvedTracks.filter((t) => dl.selectedIds.has(t.sourceId))}
                progress={dl.progress}
                onReset={dl.reset}
            />
        );
    }

    if (dl.state === 'error') {
        return (
            <div className="flex flex-col items-center justify-center py-16 gap-4">
                <i className="fa-solid fa-triangle-exclamation text-3xl text-error" />
                <p className="text-sm text-on-surface-variant">{dl.error ?? 'Something went wrong.'}</p>
                <button
                    onClick={dl.reset}
                    className="px-5 py-2 text-sm font-medium bg-surface-high border border-outline-variant/20 rounded-xl text-on-surface hover:bg-surface-highest transition-colors"
                >
                    Try Again
                </button>
            </div>
        );
    }

    return null;
}
