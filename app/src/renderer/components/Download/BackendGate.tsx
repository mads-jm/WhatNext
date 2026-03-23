/**
 * BackendGate — shown when no download backend is installed.
 * Provides install instructions for yt-dlp, spotDL, and Spytify.
 */

import type { BackendStatusResult } from '../../../shared/core/ipc-protocol';

interface BackendGateProps {
    backends: BackendStatusResult[];
}

const INSTALL_INSTRUCTIONS: Record<string, { label: string; instructions: string; docsUrl: string }> = {
    ytdlp: {
        label: 'yt-dlp',
        instructions: 'pip install yt-dlp   or   brew install yt-dlp',
        docsUrl: 'https://github.com/yt-dlp/yt-dlp#installation',
    },
    spotdl: {
        label: 'spotDL',
        instructions: 'pip install spotdl',
        docsUrl: 'https://github.com/spotDL/spotify-downloader#installation',
    },
    spytify: {
        label: 'Spytify',
        instructions: 'Download from GitHub (Windows only)',
        docsUrl: 'https://github.com/jwallet/spy-spotify',
    },
};

export function BackendGate({ backends }: BackendGateProps) {
    const missing = backends.filter((b) => !b.installed);

    return (
        <div className="flex flex-col items-center justify-center py-20 gap-6 max-w-lg mx-auto">
            <div className="w-16 h-16 rounded-full bg-surface-high flex items-center justify-center">
                <i className="fa-solid fa-plug-circle-xmark text-2xl text-on-surface-variant" />
            </div>
            <div className="text-center">
                <h3 className="text-lg font-bold font-headline text-on-surface">
                    No download backend installed
                </h3>
                <p className="text-sm text-on-surface-variant mt-1">
                    WhatNext uses external tools to download audio. Install one to get started.
                </p>
            </div>

            <div className="w-full space-y-3">
                {missing.map((b) => {
                    const info = INSTALL_INSTRUCTIONS[b.id];
                    if (!info) return null;
                    return (
                        <div
                            key={b.id}
                            className="border border-outline-variant/20 rounded-xl p-4 space-y-2"
                        >
                            <div className="flex items-center justify-between">
                                <span className="font-semibold text-on-surface font-headline">
                                    {info.label}
                                </span>
                                <button
                                    onClick={() =>
                                        window.electron?.shell.openExternal(info.docsUrl)
                                    }
                                    className="text-xs text-primary hover:underline"
                                >
                                    Docs →
                                </button>
                            </div>
                            <code className="block text-xs bg-surface-high text-on-surface-variant rounded-lg px-3 py-2 font-mono">
                                {info.instructions}
                            </code>
                            {b.error && (
                                <p className="text-xs text-error">{b.error}</p>
                            )}
                        </div>
                    );
                })}
            </div>

            <p className="text-xs text-on-surface-variant text-center">
                After installing, restart WhatNext and return here.
            </p>
        </div>
    );
}
