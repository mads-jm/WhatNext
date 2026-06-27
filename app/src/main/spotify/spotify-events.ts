/**
 * Spotify → renderer event bridge.
 *
 * The Spotify client runs in the main process but holds no reference to the
 * BrowserWindow, so it cannot call `webContents.send` directly. Instead it
 * emits structured runtime events through this single-listener bridge; main.ts
 * registers a listener that forwards them to the renderer. This keeps the
 * client free of Electron dependencies and easily testable.
 *
 * Single-listener (not EventEmitter) by design: there is exactly one main
 * window and exactly one forwarder, so the extra machinery would be noise.
 */

export type SpotifyRuntimeEvent =
    | {
          /**
           * A token refresh failed (expired/revoked refresh token). The
           * renderer should prompt the user to reconnect rather than surfacing
           * a raw error mid-flow.
           */
          type: 'auth-error';
          error: string;
      }
    | {
          /**
           * Playback control returned 403 (Premium required / missing scope).
           * The session should continue in metadata-only mode
           * (`playbackProvider: 'none'`).
           */
          type: 'playback-degraded';
          reason: 'premium-required';
          status: number;
      };

type SpotifyEventListener = (event: SpotifyRuntimeEvent) => void;

let listener: SpotifyEventListener | null = null;

/** Register (or clear, with `null`) the single runtime-event listener. */
export function setSpotifyEventListener(
    next: SpotifyEventListener | null,
): void {
    listener = next;
}

/** Emit a runtime event. No-op when no listener is registered. */
export function emitSpotifyEvent(event: SpotifyRuntimeEvent): void {
    if (!listener) return;
    try {
        listener(event);
    } catch (err) {
        console.error('[Spotify] event listener threw:', err);
    }
}
