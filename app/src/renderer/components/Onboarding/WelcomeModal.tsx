/**
 * WelcomeModal — First-run onboarding.
 * Prompts the user to set a display name on first launch.
 * Uses ModalPortal for proper z-index management.
 */

import { useState } from 'react';
import { useUserStore } from '../../stores/user-store';
import { updateLocalUserProfile } from '../../db/services/user-service';
import { ModalPortal } from '../UI/ModalPortal';
import wnorbIcon from '@assets/png/wnorb.png';

export function WelcomeModal() {
    const isFirstRun = useUserStore((s) => s.isFirstRun);
    const refreshUser = useUserStore((s) => s.refreshUser);
    const [name, setName] = useState('');
    const [saving, setSaving] = useState(false);

    const handleSave = async () => {
        const displayName = name.trim() || 'Anonymous';
        setSaving(true);
        await updateLocalUserProfile({ displayName });
        await refreshUser();
        setSaving(false);
    };

    const handleSkip = async () => {
        await updateLocalUserProfile({ displayName: 'Anonymous' });
        await refreshUser();
    };

    return (
        <ModalPortal
            open={isFirstRun}
            onClose={handleSkip}
            priority="high"
            closeOnBackdrop={false}
            closeOnEscape={false}
        >
            <div className="bg-surface border border-outline-variant rounded-xl p-8 w-full max-w-md shadow-2xl text-center">
                <img
                    src={wnorbIcon}
                    alt="WhatNext"
                    className="w-16 h-16 mx-auto mb-4 rounded-2xl"
                />

                <h2 className="text-2xl font-bold text-on-surface mb-2">
                    Welcome to WhatNext
                </h2>
                <p className="text-on-surface-variant text-sm mb-6">
                    Choose a name that others will see when you collaborate on
                    playlists.
                </p>

                <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSave()}
                    placeholder="Your display name"
                    className="input w-full mb-4 text-center text-lg"
                    maxLength={50}
                />

                <div className="flex flex-col gap-2">
                    <button
                        onClick={handleSave}
                        disabled={saving}
                        className="btn-primary w-full py-3 text-lg"
                    >
                        {saving ? 'Saving...' : 'Get Started'}
                    </button>
                    <button
                        onClick={handleSkip}
                        className="text-sm text-on-surface-variant hover:text-on-surface transition-colors"
                    >
                        Skip for now
                    </button>
                </div>
            </div>
        </ModalPortal>
    );
}
