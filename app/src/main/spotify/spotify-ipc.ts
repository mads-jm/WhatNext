/**
 * Spotify IPC — Main Process
 *
 * Owns the whole Spotify renderer-facing surface: the `spotify:*` account and
 * playlist handlers, the `SPOTIFY_*` playback-control handlers, the OAuth
 * callback arm of the `whtnxt://` protocol router, and the runtime-event
 * bridge that forwards main-process Spotify events to the renderer.
 *
 * Handlers register during module evaluation of main.ts, exactly as they did
 * when they lived there — `registerSpotifyHandlers` is called at the same
 * point in main.ts's synchronous execution, not from `app.whenReady()`.
 *
 * The BrowserWindow is reached through an accessor rather than a captured
 * value because the window is recreated on macOS `activate`; the handlers
 * always want the current one. Same shape as file-transfer-ipc's
 * `utilityGetter`.
 */

import { ipcMain } from 'electron';
import type { BrowserWindow } from 'electron';
import { IPC_CHANNELS } from '../../shared/core/ipc-protocol';
import type { SpotifyRuntimeEvent } from './spotify-events';

let _getMainWindow: () => BrowserWindow | null = () => null;

let spotifyInitialized = false;

/**
 * Forward Spotify main-process runtime events to the renderer.
 * `auth-error` reuses the existing reconnect-prompt channel; `playback-degraded`
 * signals a Premium-required downgrade so the session can drop to metadata-only.
 */
function forwardSpotifyEvent(event: SpotifyRuntimeEvent): void {
    const mainWindow = _getMainWindow();
    if (!mainWindow) return;
    if (event.type === 'auth-error') {
        mainWindow.webContents.send('spotify:auth-error', {
            error: event.error,
        });
    } else if (event.type === 'playback-degraded') {
        // The preload exposes `spotify.onPlaybackDegraded` so the renderer can
        // subscribe to this channel. The renderer-side state transition itself —
        // setting `playbackProvider: 'none'` on the session and surfacing the
        // "Premium required" UI banner — is OUT OF THIS LANE. It belongs to the
        // renderer-cluster lane that owns the session schema / playback model.
        // Tracking: epic-spotify-resilience #44 open question "Degraded-mode
        // contract: where does `playbackProvider: 'none'` live and who owns the
        // transition?" (see WhatNext - docs/08 specs/epic-spotify-resilience.md).
        mainWindow.webContents.send('spotify:playback-degraded', {
            reason: event.reason,
            status: event.status,
        });
    }
}

export async function ensureSpotifyModules(): Promise<void> {
    if (!spotifyInitialized) {
        try {
            const { loadStoredTokens } = await import('./spotify-client');
            const { setSpotifyEventListener } =
                await import('./spotify-events');
            setSpotifyEventListener(forwardSpotifyEvent);
            loadStoredTokens();
            spotifyInitialized = true;
        } catch (_e) {
            console.log('[Main] Spotify modules not ready yet');
        }
    }
}

/**
 * Handle the `whtnxt://spotify-callback` arm of the protocol router.
 * Called by main.ts's `handleProtocolUrl`.
 */
export async function handleSpotifyCallbackUrl(url: string): Promise<void> {
    // Read the window through the accessor at each use site rather than once up
    // front: this function awaits, and when it lived in main.ts every read hit
    // the live `mainWindow` binding. Caching it here would pin a window that may
    // have been closed and recreated across an await.
    try {
        const parsed = new URL(url);
        const code = parsed.searchParams.get('code');
        const error = parsed.searchParams.get('error');

        if (error) {
            console.error('[Main] Spotify auth error:', error);
            _getMainWindow()?.webContents.send('spotify:auth-error', { error });
            return;
        }

        if (!code) {
            console.error('[Main] Spotify callback missing code');
            return;
        }

        const { handleSpotifyCallback } = await import('./spotify-auth');
        const result = await handleSpotifyCallback(code);

        if (result.success && result.tokens) {
            // Token-expiry UX: the client proactively refreshes within the
            // expiry buffer and, on a failed refresh, emits a `spotify:auth-error`
            // reconnect prompt via the runtime-event bridge (see
            // forwardSpotifyEvent / ensureSpotifyModules) rather than throwing
            // mid-flow.
            const { saveTokens } = await import('./token-store');
            const { initSpotifyClient } = await import('./spotify-client');
            saveTokens(result.tokens);
            initSpotifyClient(result.tokens);
            console.log('[Main] Spotify auth complete!');
            _getMainWindow()?.webContents.send('spotify:auth-complete', {
                success: true,
            });
        } else {
            console.error('[Main] Spotify auth failed:', result.error);
            _getMainWindow()?.webContents.send('spotify:auth-error', {
                error: result.error,
            });
        }

        const mainWindow = _getMainWindow();
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.focus();
        }
    } catch (err) {
        console.error('[Main] Spotify callback handling failed:', err);
    }
}

/**
 * Register all Spotify IPC handlers.
 * Must be called during main.ts's module evaluation, before any protocol URL
 * or renderer message can arrive.
 *
 * @param mainWindowGetter - Returns the current main BrowserWindow (may be null)
 */
export function registerSpotifyHandlers(
    mainWindowGetter: () => BrowserWindow | null,
): void {
    _getMainWindow = mainWindowGetter;

    ipcMain.handle('spotify:auth-start', async () => {
        const { startSpotifyAuth } = await import('./spotify-auth');
        return startSpotifyAuth();
    });

    ipcMain.handle('spotify:auth-status', async () => {
        const { isAuthenticated } = await import('./spotify-client');
        const { hasTokens } = await import('./token-store');
        await ensureSpotifyModules();
        return {
            authenticated: isAuthenticated(),
            hasStoredTokens: hasTokens(),
        };
    });

    ipcMain.handle('spotify:get-playlists', async () => {
        try {
            const { getUserPlaylists } = await import('./spotify-client');
            const result = await getUserPlaylists();
            return {
                success: true,
                playlists: result.items,
                total: result.total,
            };
        } catch (error) {
            return { success: false, error: String(error) };
        }
    });

    ipcMain.handle('spotify:get-tracks', async (_event, playlistId: string) => {
        try {
            const { getPlaylistTracks, resolveSpotifyDisplayNames } =
                await import('./spotify-client');
            const { mapSpotifyTracks } = await import('./spotify-mapper');
            const result = await getPlaylistTracks(playlistId);
            const mapped = mapSpotifyTracks(result.items);

            // Enrich with display names from /users/{id} endpoint
            const uniqueUserIds = [
                ...new Set(mapped.map((t) => t.addedBySpotifyId)),
            ];
            const displayNames =
                await resolveSpotifyDisplayNames(uniqueUserIds);
            for (const track of mapped) {
                track.addedByDisplayName = displayNames.get(
                    track.addedBySpotifyId,
                );
            }

            return { success: true, tracks: mapped, total: result.total };
        } catch (error) {
            return { success: false, error: String(error) };
        }
    });
    // TODO : Asset
    ipcMain.handle('spotify:get-profile', async () => {
        try {
            const { getCurrentUser } = await import('./spotify-client');
            const profile = await getCurrentUser();
            return {
                success: true,
                userId: profile.id,
                displayName: profile.display_name,
                avatarUrl: profile.images?.[0]?.url,
            };
        } catch (error) {
            return { success: false, error: String(error) };
        }
    });

    ipcMain.handle(
        'spotify:sync-playlist',
        async (_event, linkedSpotifyId: string) => {
            try {
                const { getPlaylistTracks } = await import('./spotify-client');
                const { mapSpotifyTracks } = await import('./spotify-mapper');

                // Paginate through ALL tracks — playlists can exceed 100 tracks
                // TODO : ... is this? Is this limiting to 100?
                const allItems: Awaited<
                    ReturnType<typeof getPlaylistTracks>
                >['items'] = [];
                let offset = 0;
                const limit = 100;
                let total = Infinity;

                while (offset < total) {
                    const page = await getPlaylistTracks(
                        linkedSpotifyId,
                        limit,
                        offset,
                    );
                    total = page.total;
                    allItems.push(...page.items);
                    offset += page.items.length;
                    if (page.items.length < limit) break;
                }

                const mapped = mapSpotifyTracks(allItems);
                return {
                    success: true,
                    tracks: mapped,
                    total: allItems.length,
                };
            } catch (error) {
                return { success: false, error: String(error) };
            }
        },
    );

    // ========================================
    // Spotify Playback Control
    // ========================================

    ipcMain.handle(IPC_CHANNELS.SPOTIFY_GET_PLAYBACK_STATE, async () => {
        try {
            const { getPlaybackState } = await import('./spotify-client');
            const state = await getPlaybackState();
            return { success: true, state };
        } catch (error) {
            return { success: false, error: String(error) };
        }
    });

    ipcMain.handle(IPC_CHANNELS.SPOTIFY_GET_DEVICES, async () => {
        try {
            const { getDevices } = await import('./spotify-client');
            const devices = await getDevices();
            return { success: true, devices };
        } catch (error) {
            return { success: false, error: String(error) };
        }
    });

    ipcMain.handle(
        IPC_CHANNELS.SPOTIFY_START_PLAYBACK,
        async (_event, params) => {
            try {
                const { startPlayback } = await import('./spotify-client');
                await startPlayback(params);
                return { success: true };
            } catch (error) {
                return { success: false, error: String(error) };
            }
        },
    );

    ipcMain.handle(
        IPC_CHANNELS.SPOTIFY_PAUSE_PLAYBACK,
        async (_event, params?: { deviceId?: string }) => {
            try {
                const { pausePlayback } = await import('./spotify-client');
                await pausePlayback(params?.deviceId);
                return { success: true };
            } catch (error) {
                return { success: false, error: String(error) };
            }
        },
    );

    ipcMain.handle(
        IPC_CHANNELS.SPOTIFY_RESUME_PLAYBACK,
        async (_event, params?: { deviceId?: string }) => {
            try {
                const { resumePlayback } = await import('./spotify-client');
                await resumePlayback(params?.deviceId);
                return { success: true };
            } catch (error) {
                return { success: false, error: String(error) };
            }
        },
    );

    ipcMain.handle(
        IPC_CHANNELS.SPOTIFY_SKIP_NEXT,
        async (_event, params?: { deviceId?: string }) => {
            try {
                const { skipToNext } = await import('./spotify-client');
                await skipToNext(params?.deviceId);
                return { success: true };
            } catch (error) {
                return { success: false, error: String(error) };
            }
        },
    );

    ipcMain.handle(
        IPC_CHANNELS.SPOTIFY_SKIP_PREVIOUS,
        async (_event, params?: { deviceId?: string }) => {
            try {
                const { skipToPrevious } = await import('./spotify-client');
                await skipToPrevious(params?.deviceId);
                return { success: true };
            } catch (error) {
                return { success: false, error: String(error) };
            }
        },
    );

    ipcMain.handle(
        IPC_CHANNELS.SPOTIFY_SEEK_PLAYBACK,
        async (_event, params: { positionMs: number; deviceId?: string }) => {
            try {
                const { seekToPosition } = await import('./spotify-client');
                await seekToPosition(params.positionMs, params.deviceId);
                return { success: true };
            } catch (error) {
                return { success: false, error: String(error) };
            }
        },
    );

    ipcMain.handle(
        IPC_CHANNELS.SPOTIFY_GET_PLAYLIST_TRACKS_FULL,
        async (_event, playlistId: string) => {
            try {
                const { getPlaylistTracksFull } =
                    await import('./spotify-client');
                const result = await getPlaylistTracksFull(playlistId);
                return {
                    success: true,
                    tracks: result.tracks,
                    total: result.total,
                    snapshotId: result.snapshotId,
                };
            } catch (error) {
                return { success: false, error: String(error) };
            }
        },
    );

    ipcMain.handle(
        IPC_CHANNELS.SPOTIFY_GET_PLAYLIST_SNAPSHOT,
        async (_event, playlistId: string) => {
            try {
                const { getPlaylistSnapshot } =
                    await import('./spotify-client');
                const result = await getPlaylistSnapshot(playlistId);
                return {
                    success: true,
                    snapshotId: result.snapshotId,
                    total: result.total,
                };
            } catch (error) {
                return { success: false, error: String(error) };
            }
        },
    );

    ipcMain.handle(
        IPC_CHANNELS.SPOTIFY_GET_PLAYLIST_TRACKS_FROM,
        async (
            _event,
            playlistId: string,
            offset: number,
            knownSnapshotId?: string,
        ) => {
            try {
                const { getPlaylistTracksFrom } =
                    await import('./spotify-client');
                const result = await getPlaylistTracksFrom(
                    playlistId,
                    offset,
                    knownSnapshotId,
                );
                return {
                    success: true,
                    tracks: result.tracks,
                    total: result.total,
                    snapshotId: result.snapshotId,
                };
            } catch (error) {
                return { success: false, error: String(error) };
            }
        },
    );
}
