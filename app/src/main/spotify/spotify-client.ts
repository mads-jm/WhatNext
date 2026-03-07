/**
 * Spotify Web API Client
 * Handles API calls with automatic token refresh.
 */

import { SPOTIFY_CONFIG } from '../../shared/spotify-config';
import { refreshSpotifyToken } from './spotify-auth';
import { saveTokens, loadTokens } from './token-store';
import type { SpotifyTokens, SpotifyPlaylistItem, SpotifyTrackItem } from '../types';

let currentTokens: SpotifyTokens | null = null;

/**
 * Initialize client with tokens
 */
export function initSpotifyClient(tokens: SpotifyTokens): void {
    currentTokens = tokens;
}

/**
 * Load tokens from storage and initialize
 */
export function loadStoredTokens(): boolean {
    const tokens = loadTokens();
    if (tokens) {
        currentTokens = tokens;
        return true;
    }
    return false;
}

/**
 * Get valid access token, refreshing if needed
 */
async function getValidToken(): Promise<string> {
    if (!currentTokens) {
        throw new Error('Not authenticated with Spotify');
    }

    // Check if token needs refresh
    if (Date.now() >= currentTokens.expiresAt - SPOTIFY_CONFIG.REFRESH_BUFFER_MS) {
        console.log('[Spotify] Token expired, refreshing...');
        const result = await refreshSpotifyToken(currentTokens.refreshToken);
        if (!result.success || !result.tokens) {
            throw new Error(`Token refresh failed: ${result.error}`);
        }
        currentTokens = result.tokens;
        saveTokens(currentTokens);
    }

    return currentTokens.accessToken;
}

/**
 * Make authenticated API request
 */
async function spotifyFetch<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const token = await getValidToken();

    const response = await fetch(`${SPOTIFY_CONFIG.API.BASE}${endpoint}`, {
        ...options,
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
            ...options.headers,
        },
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Spotify API error ${response.status}: ${errorText}`);
    }

    return response.json();
}

// SpotifyPlaylistItem and SpotifyTrackItem are now imported from '../types'
export type { SpotifyPlaylistItem, SpotifyTrackItem } from '../types';

/**
 * Get current user's playlists
 */
export async function getUserPlaylists(limit = 50, offset = 0): Promise<{
    items: SpotifyPlaylistItem[];
    total: number;
}> {
    return spotifyFetch(`/me/playlists?limit=${limit}&offset=${offset}`);
}

/**
 * Get tracks from a playlist
 */
export async function getPlaylistTracks(playlistId: string, limit = 100, offset = 0): Promise<{
    items: SpotifyTrackItem[];
    total: number;
}> {
    return spotifyFetch(`/playlists/${playlistId}/tracks?limit=${limit}&offset=${offset}`);
}

/**
 * Get the current authenticated user's Spotify profile.
 */
export async function getCurrentUser(): Promise<{
    id: string;
    display_name: string;
    images: Array<{ url: string; height: number; width: number }>;
}> {
    return spotifyFetch('/me');
}

/**
 * Check if client is authenticated
 */
export function isAuthenticated(): boolean {
    return currentTokens !== null;
}
