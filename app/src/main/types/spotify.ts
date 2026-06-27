/**
 * Spotify Domain Types
 *
 * Consolidated type definitions for Spotify integration.
 * Re-exported from main/types barrel.
 */

export interface PKCEPair {
    verifier: string;
    challenge: string;
}

export interface SpotifyTokens {
    accessToken: string;
    refreshToken: string;
    expiresAt: number;
    scope: string;
}

export interface SpotifyImage {
    url: string;
    height: number;
    width: number;
}

export interface SpotifyArtist {
    name: string;
    id: string;
}

export interface SpotifyAlbum {
    name: string;
    images: SpotifyImage[];
}

export interface SpotifyPlaylistItem {
    id: string;
    name: string;
    description: string;
    images: SpotifyImage[];
    tracks: { total: number };
    owner: { display_name: string; id: string };
    collaborative: boolean;
    public: boolean;
}

export interface SpotifyTrackItem {
    track: {
        id: string;
        name: string;
        artists: SpotifyArtist[];
        album: SpotifyAlbum;
        duration_ms: number;
        external_urls: { spotify: string };
    };
    added_at: string;
    added_by: { id: string };
}
