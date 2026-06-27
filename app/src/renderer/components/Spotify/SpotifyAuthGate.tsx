/**
 * SpotifyAuthGate — connect button + connecting spinner.
 * Shown when the user hasn't authenticated with Spotify yet.
 */

interface SpotifyAuthGateProps {
    connecting: boolean;
    error: string | null;
    onConnect: () => void;
    onCancel: () => void;
}

export function SpotifyAuthGate({ connecting, error, onConnect, onCancel }: SpotifyAuthGateProps) {
    if (connecting) {
        return (
            <div className="flex items-center justify-center min-h-[400px]">
                <div className="text-center max-w-md">
                    <div className="w-16 h-16 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-6" />
                    <h2 className="text-xl font-bold text-on-surface mb-3">Waiting for Spotify...</h2>
                    <p className="text-on-surface-variant mb-4">
                        A browser window should have opened. Complete the login there,
                        and you will be redirected back automatically.
                    </p>
                    <button
                        onClick={onCancel}
                        className="text-sm text-on-surface-variant hover:text-on-surface transition-colors"
                    >
                        Cancel
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="flex items-center justify-center min-h-[400px]">
            <div className="text-center max-w-md">
                <div className="w-16 h-16 bg-primary rounded-full flex items-center justify-center mx-auto mb-6">
                    <i className="fa-brands fa-spotify text-surface text-3xl" />
                </div>
                <h2 className="text-2xl font-bold text-on-surface mb-3">Connect to Spotify</h2>
                <p className="text-on-surface-variant mb-6">
                    Import your Spotify playlists into WhatNext. Your data stays local --
                    we only read your playlist information.
                </p>
                <div className="space-y-3">
                    <button
                        onClick={onConnect}
                        className="w-full px-6 py-3 bg-primary hover:bg-primary-dim text-surface font-semibold rounded-lg transition-colors flex items-center justify-center gap-2"
                    >
                        <i className="fa-brands fa-spotify" />
                        Connect with Spotify
                    </button>
                    <p className="text-xs text-on-surface-variant">
                        Uses OAuth PKCE -- no passwords are shared with WhatNext.
                        Requires a Spotify Client ID to be configured.
                    </p>
                </div>
                {error && (
                    <div className="mt-4 p-3 bg-error/10 border border-error/30 rounded-lg text-error text-sm">
                        {error}
                    </div>
                )}
            </div>
        </div>
    );
}
