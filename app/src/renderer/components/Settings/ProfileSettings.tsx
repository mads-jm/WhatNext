/**
 * ProfileSettings — User identity management page.
 * Replaces the "Coming soon" placeholder for settings-general.
 */

import { useState, useEffect } from 'react';
import { useUserStore } from '../../stores/user-store';
import {
    updateLocalUserProfile,
    linkServiceAccount,
    unlinkServiceAccount,
} from '../../db/services/user-service';

export function ProfileSettings() {
    const user = useUserStore((s) => s.user);
    const loading = useUserStore((s) => s.loading);

    const [editingName, setEditingName] = useState(false);
    const [nameValue, setNameValue] = useState('');
    const [linking, setLinking] = useState(false);

    useEffect(() => {
        const cleanupComplete = window.electron?.spotify.onAuthComplete(async () => {
            try {
                const profile = await window.electron?.spotify.getProfile();
                if (profile?.success && profile.userId) {
                    await linkServiceAccount({
                        provider: 'spotify',
                        providerUserId: profile.userId,
                        displayName: profile.displayName,
                        avatarUrl: profile.avatarUrl,
                    });
                    const u = useUserStore.getState().user;
                    if (u?.avatarSource === 'none' && profile.avatarUrl) {
                        await updateLocalUserProfile({
                            avatarSource: 'spotify',
                            avatarUrl: profile.avatarUrl,
                        });
                    }
                }
            } catch (err) {
                console.error('Failed to link Spotify profile:', err);
            } finally {
                setLinking(false);
            }
        });

        const cleanupError = window.electron?.spotify.onAuthError(() => {
            setLinking(false);
        });

        return () => {
            cleanupComplete?.();
            cleanupError?.();
        };
    }, []);

    if (loading || !user) {
        return (
            <div className="text-on-surface-variant text-center py-12">
                Loading profile...
            </div>
        );
    }

    const handleNameSave = async () => {
        if (nameValue.trim()) {
            await updateLocalUserProfile({ displayName: nameValue.trim() });
        }
        setEditingName(false);
    };

    const startEditName = () => {
        setNameValue(user.displayName);
        setEditingName(true);
    };

    const spotifyLink = user.linkedAccounts.find(
        (a) => a.provider === 'spotify'
    );

    const handleSpotifyConnect = async () => {
        setLinking(true);
        try {
            const result = await window.electron?.spotify.startAuth();
            if (result && !result.success) {
                console.error('Spotify auth failed:', result.error);
                setLinking(false);
            }
            // setLinking(false) is handled by the onAuthComplete / onAuthError listeners above
        } catch (err) {
            console.error('Spotify connect error:', err);
            setLinking(false);
        }
    };

    const handleSpotifyUnlink = async () => {
        await unlinkServiceAccount('spotify');
        // Clear avatar if it was from Spotify
        if (user.avatarSource === 'spotify') {
            await updateLocalUserProfile({
                avatarSource: 'none',
                avatarUrl: undefined,
            });
        }
    };

    const initials = user.displayName.slice(0, 2).toUpperCase();

    return (
        <div className="max-w-2xl mx-auto space-y-6">
            {/* Profile Card */}
            <div className="card">
                <div className="card-header">
                    <span className="font-medium">Your Profile</span>
                </div>
                <div className="card-body">
                    <div className="flex items-center gap-6">
                        {/* Avatar */}
                        <div className="w-20 h-20 rounded-full bg-gradient-to-br from-primary-dim to-primary flex items-center justify-center text-surface text-2xl font-bold shrink-0 overflow-hidden">
                            {user.avatarUrl ? (
                                <img
                                    src={user.avatarUrl}
                                    alt=""
                                    className="w-full h-full object-cover"
                                />
                            ) : (
                                initials
                            )}
                        </div>

                        {/* Name + Info */}
                        <div className="flex-1">
                            {editingName ? (
                                <div className="flex gap-2">
                                    <input
                                        type="text"
                                        value={nameValue}
                                        onChange={(e) =>
                                            setNameValue(e.target.value)
                                        }
                                        onKeyDown={(e) =>
                                            e.key === 'Enter' &&
                                            handleNameSave()
                                        }
                                        className="input flex-1"
                                        maxLength={50}
                                    />
                                    <button
                                        onClick={handleNameSave}
                                        className="btn-primary text-sm"
                                    >
                                        Save
                                    </button>
                                    <button
                                        onClick={() => setEditingName(false)}
                                        className="btn-ghost text-sm"
                                    >
                                        Cancel
                                    </button>
                                </div>
                            ) : (
                                <div className="flex items-center gap-2">
                                    <h3 className="text-xl font-bold text-on-surface">
                                        {user.displayName}
                                    </h3>
                                    <button
                                        onClick={startEditName}
                                        className="text-on-surface-variant hover:text-on-surface transition-colors"
                                    >
                                        <i className="fa-solid fa-pen text-xs" />
                                    </button>
                                </div>
                            )}
                            <p className="text-xs text-on-surface-variant mt-1 font-mono">
                                ID: {user.id.slice(0, 16)}...
                            </p>
                            <p className="text-xs text-on-surface-variant">
                                Member since{' '}
                                {new Date(user.createdAt).toLocaleDateString()}
                            </p>
                        </div>
                    </div>
                </div>
            </div>

            {/* Linked Services */}
            <div className="card">
                <div className="card-header">
                    <span className="font-medium">Linked Services</span>
                </div>
                <div className="card-body space-y-3">
                    {/* Spotify */}
                    <div className="flex items-center justify-between p-3 rounded-lg bg-surface-high/50">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 bg-primary rounded-full flex items-center justify-center">
                                <i className="fa-brands fa-spotify text-surface text-lg" />
                            </div>
                            <div>
                                <div className="text-sm font-medium text-on-surface">
                                    Spotify
                                </div>
                                {spotifyLink ? (
                                    <div className="text-xs text-primary">
                                        Connected as{' '}
                                        {spotifyLink.displayName ||
                                            spotifyLink.providerUserId}
                                    </div>
                                ) : (
                                    <div className="text-xs text-on-surface-variant">
                                        Not connected
                                    </div>
                                )}
                            </div>
                        </div>
                        {spotifyLink ? (
                            <button
                                onClick={handleSpotifyUnlink}
                                className="text-xs text-error hover:text-error/80 transition-colors"
                            >
                                Unlink
                            </button>
                        ) : (
                            <button
                                onClick={handleSpotifyConnect}
                                disabled={linking}
                                className="btn-ghost text-xs"
                            >
                                {linking ? 'Connecting...' : 'Connect'}
                            </button>
                        )}
                    </div>

                    {/* Future services */}
                    {['Apple Music', 'YouTube Music'].map((service) => (
                        <div
                            key={service}
                            className="flex items-center justify-between p-3 rounded-lg bg-surface-high/30 opacity-50"
                        >
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 bg-surface-high rounded-full flex items-center justify-center">
                                    <i className="fa-solid fa-music text-on-surface-variant" />
                                </div>
                                <div>
                                    <div className="text-sm font-medium text-on-surface-variant">
                                        {service}
                                    </div>
                                    <div className="text-xs text-on-surface-variant">
                                        Coming in Phase 2
                                    </div>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
