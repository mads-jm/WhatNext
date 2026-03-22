/**
 * Spotify Web API Client
 * Handles API calls with automatic token refresh.
 */

import { SPOTIFY_CONFIG } from '../../shared/spotify-config';
import { refreshSpotifyToken } from './spotify-auth';
import { saveTokens, loadTokens } from './token-store';
import type { SpotifyTokens, SpotifyPlaylistItem, SpotifyTrackItem } from '../types';
import type {
    SpotifyPlaybackStateResult,
    SpotifyDevice,
    SpotifyStartPlaybackParams,
    SpotifyFullTrackItem,
} from '../../shared/core/ipc-protocol';

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
 * Get a public Spotify user's profile by ID.
 * Returns display_name (and other public fields).
 */
export async function getUserProfile(userId: string): Promise<{
    id: string;
    display_name: string;
    images: Array<{ url: string; height: number; width: number }>;
}> {
    return spotifyFetch(`/users/${encodeURIComponent(userId)}`);
}

/**
 * Batch-resolve Spotify user IDs to display names.
 * Fires one request per unique ID (Spotify has no batch endpoint).
 * Failures are silently skipped — the caller falls back to the raw ID.
 */
export async function resolveSpotifyDisplayNames(
    userIds: string[]
): Promise<Map<string, string>> {
    const results = new Map<string, string>();
    await Promise.all(
        userIds.map(async (id) => {
            try {
                const profile = await getUserProfile(id);
                if (profile.display_name) {
                    results.set(id, profile.display_name);
                }
            } catch {
                // Skip — caller will use the raw Spotify ID as fallback
            }
        })
    );
    return results;
}

/**
 * Check if client is authenticated
 */
export function isAuthenticated(): boolean {
    return currentTokens !== null;
}

/**
 * Authenticated fetch returning the raw Response.
 * Use this when you need to inspect the status code before parsing (e.g. 204 No Content).
 */
async function spotifyFetchRaw(endpoint: string, options: RequestInit = {}): Promise<Response> {
    const token = await getValidToken();
    const response = await fetch(`${SPOTIFY_CONFIG.API.BASE}${endpoint}`, {
        ...options,
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
            ...options.headers,
        },
    });

    if (!response.ok && response.status !== 204) {
        const errorText = await response.text().catch(() => '(no body)');
        throw new Error(`Spotify API error ${response.status}: ${errorText}`);
    }

    return response;
}

// ========================================
// Playback Control
// ========================================

/**
 * Get the user's current Spotify playback state.
 * Returns null when no active device (Spotify responds with 204).
 */
export async function getPlaybackState(): Promise<SpotifyPlaybackStateResult | null> {
    const response = await spotifyFetchRaw('/me/player');

    if (response.status === 204) {
        return null;
    }

    const data = await response.json();

    const track = data.item
        ? {
              spotifyId: data.item.id as string,
              title: data.item.name as string,
              artists: (data.item.artists as Array<{ name: string }>).map((a) => a.name),
              album: data.item.album.name as string,
              durationMs: data.item.duration_ms as number,
              albumArtUrl: (data.item.album.images as Array<{ url: string }>)[0]?.url,
          }
        : null;

    return {
        isPlaying: data.is_playing as boolean,
        track,
        progressMs: (data.progress_ms as number) ?? 0,
        deviceName: data.device?.name ?? null,
        deviceId: data.device?.id ?? null,
    };
}

/**
 * Get the user's available Spotify playback devices.
 */
export async function getDevices(): Promise<SpotifyDevice[]> {
    const data = await spotifyFetch<{ devices: Array<{ id: string; name: string; type: string; is_active: boolean }> }>('/me/player/devices');
    return data.devices.map((d) => ({
        id: d.id,
        name: d.name,
        type: d.type,
        isActive: d.is_active,
    }));
}

/**
 * Start or resume playback. Optionally targets a context (playlist/album) at a given offset.
 */
export async function startPlayback(params: SpotifyStartPlaybackParams): Promise<void> {
    const query = params.deviceId ? `?device_id=${params.deviceId}` : '';
    let body: Record<string, unknown> | undefined;

    if (params.contextUri !== undefined) {
        body = { context_uri: params.contextUri };
        if (params.offsetIndex !== undefined) {
            body.offset = { position: params.offsetIndex };
        }
    }

    await spotifyFetchRaw(`/me/player/play${query}`, {
        method: 'PUT',
        body: body !== undefined ? JSON.stringify(body) : undefined,
    });
}

/**
 * Pause playback on the active (or specified) device.
 */
export async function pausePlayback(deviceId?: string): Promise<void> {
    const query = deviceId ? `?device_id=${deviceId}` : '';
    await spotifyFetchRaw(`/me/player/pause${query}`, { method: 'PUT' });
}

/**
 * Resume playback (unpause) on the active (or specified) device.
 */
export async function resumePlayback(deviceId?: string): Promise<void> {
    const query = deviceId ? `?device_id=${deviceId}` : '';
    await spotifyFetchRaw(`/me/player/play${query}`, { method: 'PUT' });
}

/**
 * Skip to the next track.
 */
export async function skipToNext(deviceId?: string): Promise<void> {
    const query = deviceId ? `?device_id=${deviceId}` : '';
    await spotifyFetchRaw(`/me/player/next${query}`, { method: 'POST' });
}

/**
 * Skip to the previous track.
 */
export async function skipToPrevious(deviceId?: string): Promise<void> {
    const query = deviceId ? `?device_id=${deviceId}` : '';
    await spotifyFetchRaw(`/me/player/previous${query}`, { method: 'POST' });
}

/**
 * Seek to a position in the currently playing track.
 */
export async function seekToPosition(positionMs: number, deviceId?: string): Promise<void> {
    const params = new URLSearchParams({ position_ms: String(positionMs) });
    if (deviceId) params.set('device_id', deviceId);
    await spotifyFetchRaw(`/me/player/seek?${params}`, { method: 'PUT' });
}

// ========================================
// Enhanced Playlist Polling (with attribution)
// ========================================

// In-memory cache for Spotify display names — survives across polls
const displayNameCache = new Map<string, string>();

/**
 * Lightweight check: fetch only snapshot_id and total track count.
 * One tiny API call (~200 bytes) to decide whether a full fetch is needed.
 */
export async function getPlaylistSnapshot(playlistId: string): Promise<{
    snapshotId: string;
    total: number;
}> {
    const data = await spotifyFetch<{
        snapshot_id: string;
        tracks: { total: number };
    }>(`/playlists/${playlistId}?fields=${encodeURIComponent('snapshot_id,tracks.total')}`);
    return { snapshotId: data.snapshot_id, total: data.tracks.total };
}

type RawPlaylistTrackItem = {
    track: { id: string; name: string; artists: Array<{ name: string }>; album: { name: string; images: Array<{ url: string }> }; duration_ms: number } | null;
    added_at: string;
    added_by: { id: string };
};

/**
 * Fetch tracks from a playlist starting at a given offset.
 * Paginates automatically from `offset` to end. Uses field filtering.
 */
export async function getPlaylistTracksFrom(playlistId: string, offset: number, knownSnapshotId?: string): Promise<{
    tracks: SpotifyFullTrackItem[];
    total: number;
    snapshotId: string;
}> {
    const fields = 'items(track(id,name,artists(name),album(name,images),duration_ms),added_at,added_by(id)),total,next,offset,limit';
    const allItems: RawPlaylistTrackItem[] = [];

    type PageResponse = { items: RawPlaylistTrackItem[]; total: number; next: string | null };
    let url: string | null = `/playlists/${playlistId}/tracks?offset=${offset}&limit=100&fields=${encodeURIComponent(fields)}`;
    let total = 0;

    while (url) {
        const pageData: PageResponse = await spotifyFetch<PageResponse>(url);
        allItems.push(...pageData.items);
        total = pageData.total;
        url = pageData.next;
    }

    // Use provided snapshotId if available, otherwise fetch separately
    let snapshotId: string;
    if (knownSnapshotId) {
        snapshotId = knownSnapshotId;
    } else {
        const snapshotData = await spotifyFetch<{ snapshot_id: string }>(
            `/playlists/${playlistId}?fields=snapshot_id`
        );
        snapshotId = snapshotData.snapshot_id;
    }

    const tracks = mapRawItems(allItems);

    // Resolve only unknown display names
    const unknownUserIds = [...new Set(tracks.map((t) => t.addedBySpotifyId))]
        .filter((id) => !displayNameCache.has(id));
    if (unknownUserIds.length > 0) {
        const resolved = await resolveSpotifyDisplayNames(unknownUserIds);
        for (const [id, name] of resolved) displayNameCache.set(id, name);
    }
    for (const track of tracks) {
        const cached = displayNameCache.get(track.addedBySpotifyId);
        if (cached) track.addedByDisplayName = cached;
    }

    return { tracks, total, snapshotId };
}

/**
 * Fetch all tracks from a playlist including who added each one.
 * Paginates automatically. Uses field filtering to minimise payload.
 */
export async function getPlaylistTracksFull(playlistId: string): Promise<{
    tracks: SpotifyFullTrackItem[];
    total: number;
    snapshotId: string;
}> {
    return getPlaylistTracksFrom(playlistId, 0);
}

function mapRawItems(items: RawPlaylistTrackItem[]): SpotifyFullTrackItem[] {
    return items
        .filter((item) => item.track !== null)
        .map((item) => {
            const track = item.track!;
            return {
                spotifyId: track.id,
                title: track.name,
                artists: track.artists.map((a) => a.name),
                album: track.album.name,
                durationMs: track.duration_ms,
                albumArtUrl: track.album.images[0]?.url,
                addedAt: item.added_at,
                addedBySpotifyId: item.added_by.id,
            };
        });
}
