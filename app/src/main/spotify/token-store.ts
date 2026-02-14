/**
 * Secure Token Storage
 * Uses Electron's safeStorage to encrypt tokens at rest.
 * Falls back to plaintext in dev if safeStorage unavailable.
 */

import { app, safeStorage } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import type { SpotifyTokens } from './spotify-auth';

const TOKEN_FILE = 'spotify-tokens.enc';

function getTokenPath(): string {
    return path.join(app.getPath('userData'), TOKEN_FILE);
}

/**
 * Save tokens encrypted to disk
 */
export function saveTokens(tokens: SpotifyTokens): void {
    const tokenPath = getTokenPath();
    const data = JSON.stringify(tokens);

    if (safeStorage.isEncryptionAvailable()) {
        const encrypted = safeStorage.encryptString(data);
        fs.writeFileSync(tokenPath, encrypted);
    } else {
        // Dev fallback: plaintext (not for production)
        console.warn('[TokenStore] safeStorage unavailable, storing tokens in plaintext');
        fs.writeFileSync(tokenPath, data, 'utf-8');
    }
}

/**
 * Load tokens from disk
 */
export function loadTokens(): SpotifyTokens | null {
    const tokenPath = getTokenPath();

    if (!fs.existsSync(tokenPath)) {
        return null;
    }

    try {
        const fileData = fs.readFileSync(tokenPath);

        if (safeStorage.isEncryptionAvailable()) {
            const decrypted = safeStorage.decryptString(fileData);
            return JSON.parse(decrypted);
        } else {
            return JSON.parse(fileData.toString('utf-8'));
        }
    } catch (error) {
        console.error('[TokenStore] Failed to load tokens:', error);
        return null;
    }
}

/**
 * Clear stored tokens
 */
export function clearTokens(): void {
    const tokenPath = getTokenPath();
    if (fs.existsSync(tokenPath)) {
        fs.unlinkSync(tokenPath);
    }
}

/**
 * Check if tokens are stored
 */
export function hasTokens(): boolean {
    return fs.existsSync(getTokenPath());
}
