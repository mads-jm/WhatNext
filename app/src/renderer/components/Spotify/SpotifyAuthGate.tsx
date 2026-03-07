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
                    <div className="w-16 h-16 border-4 border-green-600 border-t-transparent rounded-full animate-spin mx-auto mb-6" />
                    <h2 className="text-xl font-bold text-gray-100 mb-3">Waiting for Spotify...</h2>
                    <p className="text-gray-400 mb-4">
                        A browser window should have opened. Complete the login there,
                        and you will be redirected back automatically.
                    </p>
                    <button
                        onClick={onCancel}
                        className="text-sm text-gray-500 hover:text-gray-300 transition-colors"
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
                <div className="w-16 h-16 bg-green-600 rounded-full flex items-center justify-center mx-auto mb-6">
                    <i className="fa-brands fa-spotify text-white text-3xl" />
                </div>
                <h2 className="text-2xl font-bold text-gray-100 mb-3">Connect to Spotify</h2>
                <p className="text-gray-400 mb-6">
                    Import your Spotify playlists into WhatNext. Your data stays local --
                    we only read your playlist information.
                </p>
                <div className="space-y-3">
                    <button
                        onClick={onConnect}
                        className="w-full px-6 py-3 bg-green-600 hover:bg-green-500 text-white font-semibold rounded-lg transition-colors flex items-center justify-center gap-2"
                    >
                        <i className="fa-brands fa-spotify" />
                        Connect with Spotify
                    </button>
                    <p className="text-xs text-gray-500">
                        Uses OAuth PKCE -- no passwords are shared with WhatNext.
                        Requires a Spotify Client ID to be configured.
                    </p>
                </div>
                {error && (
                    <div className="mt-4 p-3 bg-red-900/50 border border-red-700 rounded-lg text-red-300 text-sm">
                        {error}
                    </div>
                )}
            </div>
        </div>
    );
}
