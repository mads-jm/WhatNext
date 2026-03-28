/**
 * DownloadSettings — configure download tools, default format, and storage.
 */

import { useState, useEffect } from 'react';
import type { BackendStatusResult } from '../../../shared/core/ipc-protocol';

const FORMAT_KEY = 'whatnext:download-default-format';
const PURCHASE_LINKS_KEY = 'whatnext:download-auto-purchase-links';

const FORMAT_OPTIONS = [
    { value: 'best_audio', label: 'Best Available (recommended)' },
    { value: 'mp3', label: 'MP3' },
    { value: 'opus', label: 'Opus' },
    { value: 'flac', label: 'FLAC' },
    { value: 'm4a', label: 'M4A' },
];

interface BackendInstallInfo {
    id: string;
    name: string;
    installUrl: string;
    installNote: string;
}

const BACKEND_INFO: BackendInstallInfo[] = [
    {
        id: 'ytdlp',
        name: 'yt-dlp',
        installUrl: 'https://github.com/yt-dlp/yt-dlp#installation',
        installNote: 'pip install yt-dlp  or  winget install yt-dlp',
    },
    {
        id: 'spotdl',
        name: 'spotDL',
        installUrl: 'https://github.com/spotDL/spotify-downloader#installation',
        installNote: 'pip install spotdl',
    },
    {
        id: 'spytify',
        name: 'Spytify',
        installUrl: 'https://jwallet.github.io/spy-spotify/',
        installNote: 'Windows only — download from GitHub releases',
    },
];

export function DownloadSettings() {
    const [backends, setBackends] = useState<BackendStatusResult[]>([]);
    const [checkingBackends, setCheckingBackends] = useState(true);
    const [audioDir, setAudioDir] = useState('');
    const [defaultFormat, setDefaultFormat] = useState(
        () => localStorage.getItem(FORMAT_KEY) || 'best_audio',
    );
    const [autoPurchaseLinks, setAutoPurchaseLinks] = useState(
        () => localStorage.getItem(PURCHASE_LINKS_KEY) !== 'false',
    );

    useEffect(() => {
        window.electron?.download.checkBackends().then((results) => {
            setBackends(results);
            setCheckingBackends(false);
        }).catch(() => setCheckingBackends(false));

        window.electron?.app.getPath('documents').then((docs) => {
            setAudioDir(`${docs}\\WhatNext\\audio`);
        });
    }, []);

    const openAudioDir = () => {
        if (audioDir) window.electron?.shell.openPath(audioDir);
    };

    const handleFormatChange = (fmt: string) => {
        setDefaultFormat(fmt);
        localStorage.setItem(FORMAT_KEY, fmt);
    };

    const handlePurchaseLinksToggle = () => {
        const next = !autoPurchaseLinks;
        setAutoPurchaseLinks(next);
        localStorage.setItem(PURCHASE_LINKS_KEY, String(next));
    };

    const recheck = () => {
        setCheckingBackends(true);
        window.electron?.download.checkBackends().then((results) => {
            setBackends(results);
            setCheckingBackends(false);
        }).catch(() => setCheckingBackends(false));
    };

    return (
        <div className="p-6 max-w-2xl space-y-8">
            <div>
                <h2 className="text-lg font-semibold text-on-surface mb-1">Download</h2>
                <p className="text-sm text-on-surface-variant">
                    Configure external download tools and preferences. Tools must be installed
                    independently — WhatNext never bundles them.
                </p>
            </div>

            {/* Backend tools */}
            <section className="space-y-3">
                <div className="flex items-center justify-between">
                    <h3 className="text-sm font-medium text-on-surface uppercase tracking-widest">
                        Backend Tools
                    </h3>
                    <button
                        onClick={recheck}
                        disabled={checkingBackends}
                        className="text-xs text-primary hover:underline disabled:opacity-50"
                    >
                        {checkingBackends ? (
                            <><i className="fa-solid fa-spinner fa-spin mr-1" />Checking…</>
                        ) : (
                            'Re-check'
                        )}
                    </button>
                </div>

                <div className="space-y-2">
                    {BACKEND_INFO.map((info) => {
                        const status = backends.find((b) => b.id === info.id);
                        const installed = status?.installed ?? false;
                        const version = status?.version;

                        return (
                            <div
                                key={info.id}
                                className="bg-surface-high rounded-lg p-4 flex items-center gap-4"
                            >
                                <div
                                    className={`w-2 h-2 rounded-full shrink-0 ${
                                        checkingBackends
                                            ? 'bg-on-surface-variant/40'
                                            : installed
                                              ? 'bg-primary'
                                              : 'bg-error/60'
                                    }`}
                                />
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2">
                                        <span className="text-sm font-medium text-on-surface">
                                            {info.name}
                                        </span>
                                        {installed && version && (
                                            <span className="text-xs text-on-surface-variant font-mono">
                                                {version}
                                            </span>
                                        )}
                                        {!installed && !checkingBackends && (
                                            <span className="text-xs text-error">Not found</span>
                                        )}
                                    </div>
                                    {!installed && !checkingBackends && (
                                        <p className="text-xs text-on-surface-variant mt-0.5 font-mono">
                                            {info.installNote}
                                        </p>
                                    )}
                                </div>
                                {!installed && !checkingBackends && (
                                    <button
                                        onClick={() =>
                                            window.electron?.shell.openExternal(info.installUrl)
                                        }
                                        className="text-xs text-primary hover:underline shrink-0"
                                    >
                                        Install
                                    </button>
                                )}
                            </div>
                        );
                    })}
                </div>
            </section>

            {/* Default format */}
            <section className="space-y-3">
                <h3 className="text-sm font-medium text-on-surface uppercase tracking-widest">
                    Default Format
                </h3>
                <div className="bg-surface-high rounded-lg p-4 space-y-2">
                    <p className="text-xs text-on-surface-variant">
                        Applied when you don't override the format per-track.
                    </p>
                    <select
                        value={defaultFormat}
                        onChange={(e) => handleFormatChange(e.target.value)}
                        className="w-full bg-surface border border-outline-variant/20 rounded-lg px-3 py-2 text-sm text-on-surface focus:outline-none focus:border-primary/50"
                    >
                        {FORMAT_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>
                                {o.label}
                            </option>
                        ))}
                    </select>
                </div>
            </section>

            {/* Audio storage */}
            <section className="space-y-3">
                <h3 className="text-sm font-medium text-on-surface uppercase tracking-widest">
                    Audio Storage
                </h3>
                <div className="bg-surface-high rounded-lg p-4 space-y-3">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-sm text-on-surface">Downloaded audio</p>
                            <p className="text-xs text-on-surface-variant">
                                yt-dlp and spotDL save files here
                            </p>
                        </div>
                        <button
                            onClick={openAudioDir}
                            disabled={!audioDir}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-surface hover:bg-outline-variant/20 disabled:opacity-50 text-on-surface text-xs rounded-md transition-colors"
                        >
                            <i className="fa-solid fa-folder-open" />
                            Open
                        </button>
                    </div>
                    <div className="bg-surface rounded px-3 py-2 text-xs font-mono text-on-surface-variant break-all">
                        {audioDir || 'Loading…'}
                    </div>
                    <p className="text-xs text-on-surface-variant">
                        To change the audio directory, use the{' '}
                        <code className="font-mono bg-surface px-1 rounded">--output</code> flag
                        in yt-dlp / spotDL directly. Custom path configuration is planned for a
                        future release.
                    </p>
                </div>
            </section>

            {/* Artist attribution */}
            <section className="space-y-3">
                <h3 className="text-sm font-medium text-on-surface uppercase tracking-widest">
                    Artist Attribution
                </h3>
                <div className="bg-surface-high rounded-lg p-4">
                    <label className="flex items-center justify-between cursor-pointer">
                        <div>
                            <p className="text-sm text-on-surface">
                                Auto-resolve purchase links
                            </p>
                            <p className="text-xs text-on-surface-variant mt-0.5">
                                After each download, look up Bandcamp / Beatport links via
                                MusicBrainz in the background
                            </p>
                        </div>
                        <button
                            onClick={handlePurchaseLinksToggle}
                            className={`relative w-11 h-6 rounded-full transition-colors ${
                                autoPurchaseLinks ? 'bg-primary' : 'bg-outline-variant/40'
                            }`}
                            role="switch"
                            aria-checked={autoPurchaseLinks}
                        >
                            <span
                                className={`absolute top-0.5 left-0.5 w-5 h-5 bg-surface rounded-full shadow transition-transform ${
                                    autoPurchaseLinks ? 'translate-x-5' : 'translate-x-0'
                                }`}
                            />
                        </button>
                    </label>
                </div>
            </section>
        </div>
    );
}
