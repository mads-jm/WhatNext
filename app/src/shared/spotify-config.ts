/**
 * Spotify Integration Configuration
 * OAuth PKCE settings and API endpoints
 */

export const SPOTIFY_CONFIG = {
    /**
     * Spotify Application Client ID
     * Register at: https://developer.spotify.com/dashboard
     * Set redirect URI to: whtnxt://spotify-callback
     */
    CLIENT_ID: '259bf71ed30d487888276caa1cd0878f', // User must set this

    /** OAuth redirect URI (custom protocol handler) */
    REDIRECT_URI: 'whtnxt://spotify-callback',

    /** Required OAuth scopes */
    SCOPES: [
        'playlist-read-private',
        'playlist-read-collaborative',
        'user-library-read',
        'user-read-playback-state',
        'user-modify-playback-state',
        'user-read-currently-playing',
    ],

    /** Spotify API endpoints */
    API: {
        AUTHORIZE: 'https://accounts.spotify.com/authorize',
        TOKEN: 'https://accounts.spotify.com/api/token',
        BASE: 'https://api.spotify.com/v1',
    },

    /** Token refresh buffer (refresh 5 min before expiry) */
    REFRESH_BUFFER_MS: 5 * 60 * 1000,
} as const;
