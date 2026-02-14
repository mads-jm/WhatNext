/**
 * Spotify OAuth PKCE Flow
 * Handles authorization entirely in the main process.
 * PKCE (Proof Key for Code Exchange) is designed for public clients
 * like desktop apps - no client secret needed.
 */

import crypto from 'node:crypto';
import { shell } from 'electron';
import { SPOTIFY_CONFIG } from '../../shared/spotify-config';
import type { PKCEPair, SpotifyTokens } from '../types';

// Store PKCE verifier for the current auth flow
let currentVerifier: string | null = null;

/**
 * Generate PKCE code verifier and challenge
 */
function generatePKCE(): PKCEPair {
    // Generate random 32-byte verifier, base64url encode
    const verifier = crypto.randomBytes(32)
        .toString('base64url');

    // SHA256 hash the verifier, base64url encode for challenge
    const challenge = crypto.createHash('sha256')
        .update(verifier)
        .digest('base64url');

    return { verifier, challenge };
}

/**
 * Start OAuth flow - opens browser for user authorization
 */
export async function startSpotifyAuth(): Promise<{ success: boolean; error?: string }> {
    if (!SPOTIFY_CONFIG.CLIENT_ID) {
        return { success: false, error: 'Spotify Client ID not configured. Set it in spotify-config.ts' };
    }

    const pkce = generatePKCE();
    currentVerifier = pkce.verifier;

    const params = new URLSearchParams({
        client_id: SPOTIFY_CONFIG.CLIENT_ID,
        response_type: 'code',
        redirect_uri: SPOTIFY_CONFIG.REDIRECT_URI,
        scope: SPOTIFY_CONFIG.SCOPES.join(' '),
        code_challenge_method: 'S256',
        code_challenge: pkce.challenge,
    });

    const authUrl = `${SPOTIFY_CONFIG.API.AUTHORIZE}?${params.toString()}`;

    try {
        await shell.openExternal(authUrl);
        return { success: true };
    } catch (error) {
        currentVerifier = null;
        return { success: false, error: `Failed to open browser: ${error}` };
    }
}

/**
 * Handle the OAuth callback - exchange code for tokens
 */
export async function handleSpotifyCallback(code: string): Promise<{
    success: boolean;
    tokens?: SpotifyTokens;
    error?: string;
}> {
    if (!currentVerifier) {
        return { success: false, error: 'No pending auth flow. Start auth first.' };
    }

    const verifier = currentVerifier;
    currentVerifier = null;

    try {
        const response = await fetch(SPOTIFY_CONFIG.API.TOKEN, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({
                grant_type: 'authorization_code',
                code,
                redirect_uri: SPOTIFY_CONFIG.REDIRECT_URI,
                client_id: SPOTIFY_CONFIG.CLIENT_ID,
                code_verifier: verifier,
            }),
        });

        if (!response.ok) {
            const errorData = await response.text();
            return { success: false, error: `Token exchange failed: ${errorData}` };
        }

        const data = await response.json();
        const tokens: SpotifyTokens = {
            accessToken: data.access_token,
            refreshToken: data.refresh_token,
            expiresAt: Date.now() + (data.expires_in * 1000),
            scope: data.scope,
        };

        return { success: true, tokens };
    } catch (error) {
        return { success: false, error: `Token exchange error: ${error}` };
    }
}

/**
 * Refresh an expired access token
 */
export async function refreshSpotifyToken(refreshToken: string): Promise<{
    success: boolean;
    tokens?: SpotifyTokens;
    error?: string;
}> {
    try {
        const response = await fetch(SPOTIFY_CONFIG.API.TOKEN, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({
                grant_type: 'refresh_token',
                refresh_token: refreshToken,
                client_id: SPOTIFY_CONFIG.CLIENT_ID,
            }),
        });

        if (!response.ok) {
            const errorData = await response.text();
            return { success: false, error: `Token refresh failed: ${errorData}` };
        }

        const data = await response.json();
        const tokens: SpotifyTokens = {
            accessToken: data.access_token,
            refreshToken: data.refresh_token || refreshToken,
            expiresAt: Date.now() + (data.expires_in * 1000),
            scope: data.scope,
        };

        return { success: true, tokens };
    } catch (error) {
        return { success: false, error: `Token refresh error: ${error}` };
    }
}

// SpotifyTokens is now imported from '../types'
export type { SpotifyTokens } from '../types';
