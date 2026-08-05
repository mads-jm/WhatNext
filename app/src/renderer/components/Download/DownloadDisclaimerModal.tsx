/**
 * DownloadDisclaimerModal — one-time acknowledgment before using download features.
 *
 * Shown on first visit to the Download view. Persisted to localStorage so it
 * only appears once per installation.
 *
 * Covers:
 *  - WhatNext wraps external tools (yt-dlp, spotDL, Spytify); never bundles them
 *  - User is responsible for respecting copyright and content rights
 *  - Bandcamp downloads are legitimate purchases (highlighted positively)
 */

import { ModalPortal } from '../UI/ModalPortal';
import { acceptDisclaimer } from '../../utils/download-disclaimer';

interface DownloadDisclaimerModalProps {
    open: boolean;
    onAccept: () => void;
}

export function DownloadDisclaimerModal({ open, onAccept }: DownloadDisclaimerModalProps) {
    const handleAccept = () => {
        acceptDisclaimer();
        onAccept();
    };

    return (
        <ModalPortal
            open={open}
            onClose={handleAccept} // accepting is the only way out
            priority="high"
            closeOnBackdrop={false}
            closeOnEscape={false}
        >
            <div className="bg-surface border border-outline-variant rounded-xl p-8 w-full max-w-md shadow-2xl">
                <div className="flex items-center gap-3 mb-5">
                    <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                        <i className="fa-solid fa-cloud-arrow-down text-primary" />
                    </div>
                    <h2 className="text-xl font-bold text-on-surface font-headline">
                        Download Tools
                    </h2>
                </div>

                <div className="space-y-4 text-sm text-on-surface-variant mb-6">
                    <p>
                        WhatNext provides a convenient interface for{' '}
                        <strong className="text-on-surface">yt-dlp</strong>,{' '}
                        <strong className="text-on-surface">spotDL</strong>, and{' '}
                        <strong className="text-on-surface">Spytify</strong> — external tools
                        that you install independently. WhatNext never bundles or distributes
                        them.
                    </p>

                    <p>
                        You are responsible for ensuring that your use of these tools complies
                        with the terms of service of the platforms you access and the copyright
                        laws applicable in your jurisdiction.
                    </p>

                    <div className="flex items-start gap-3 p-3 rounded-lg bg-[#1da0c3]/10 border border-[#1da0c3]/20">
                        <i className="fa-brands fa-bandcamp text-[#1da0c3] mt-0.5 shrink-0" />
                        <p className="text-[#1da0c3]">
                            <strong>Bandcamp note:</strong> Downloading from Bandcamp is a
                            purchase — you're paying the artist directly. WhatNext highlights
                            this as the preferred way to support independent musicians.
                        </p>
                    </div>
                </div>

                <button
                    onClick={handleAccept}
                    className="w-full py-3 text-sm font-bold bg-gradient-to-r from-primary to-primary-dim text-surface rounded-xl hover:opacity-90 transition-opacity"
                >
                    I understand — let's go
                </button>
            </div>
        </ModalPortal>
    );
}
