/**
 * Companion IPC — Main Process
 *
 * Owns the renderer-facing companion-server surface: lifecycle
 * (start/stop/info), the relay tunnel, QR-code generation, the time-request
 * acknowledgement, and the five fire-and-forget state pushes that fan session
 * state out to connected phones over WebSocket.
 *
 * Handlers register during module evaluation of main.ts, exactly as they did
 * when they lived there — `registerCompanionHandlers` is called at the same
 * point in main.ts's synchronous execution, not from `app.whenReady()`.
 *
 * The BrowserWindow is reached through an accessor rather than a captured
 * value because the window is recreated on macOS `activate`, and the
 * server-event callbacks below fire long after registration; they always want
 * the current window. Same shape as file-transfer-ipc's `utilityGetter`.
 *
 * Note the five push channels are `ipcMain.on`, not `handle` — the renderer
 * does not await them.
 */

import { ipcMain } from 'electron';
import type { BrowserWindow } from 'electron';
import { IPC_CHANNELS } from '../../shared/core/ipc-protocol';

/**
 * Register all companion-server IPC handlers.
 * Must be called during main.ts's module evaluation.
 *
 * @param mainWindowGetter - Returns the current main BrowserWindow (may be null)
 */
export function registerCompanionHandlers(
    mainWindowGetter: () => BrowserWindow | null,
): void {
    ipcMain.handle(IPC_CHANNELS.COMPANION_START, async () => {
        const { startCompanionServer, isCompanionServerRunning } =
            await import('./companion-server');

        if (isCompanionServerRunning()) {
            const { getCompanionServerInfo } =
                await import('./companion-server');
            const info = getCompanionServerInfo();
            return {
                port: info?.port ?? 0,
                localIp: info?.localIp ?? '127.0.0.1',
                joinPin: info?.joinPin ?? '',
            };
        }

        const { port, localIp, joinPin } = await startCompanionServer({
            onClientJoined: (client) => {
                mainWindowGetter()?.webContents.send(
                    IPC_CHANNELS.COMPANION_CLIENT_JOINED,
                    {
                        clientId: client.id,
                        displayName: client.displayName,
                    },
                );
            },
            onClientLeft: (client) => {
                mainWindowGetter()?.webContents.send(
                    IPC_CHANNELS.COMPANION_CLIENT_LEFT,
                    {
                        clientId: client.id,
                        displayName: client.displayName,
                    },
                );
            },
            onReaction: (clientId, displayName, emoji, trackId) => {
                mainWindowGetter()?.webContents.send(
                    IPC_CHANNELS.COMPANION_REACTION,
                    {
                        clientId,
                        displayName,
                        emoji,
                        trackId,
                    },
                );
            },
            onTimeRequest: (clientId, displayName, trackId) => {
                mainWindowGetter()?.webContents.send(
                    IPC_CHANNELS.COMPANION_TIME_REQUEST,
                    {
                        clientId,
                        displayName,
                        trackId,
                    },
                );
            },
        });

        return { port, localIp, joinPin };
    });

    ipcMain.handle(IPC_CHANNELS.COMPANION_STOP, async () => {
        const { stopCompanionServer } = await import('./companion-server');
        stopCompanionServer();
    });

    ipcMain.handle(
        IPC_CHANNELS.COMPANION_QR_CODE,
        async (_event, url: string) => {
            const QRCode = await import('qrcode');
            return QRCode.toDataURL(url, {
                width: 256,
                margin: 2,
                color: { dark: '#e5e7ebff', light: '#11182700' },
            });
        },
    );

    ipcMain.handle(IPC_CHANNELS.COMPANION_GET_INFO, async () => {
        const { getCompanionServerInfo } = await import('./companion-server');
        return getCompanionServerInfo();
    });

    ipcMain.handle(
        IPC_CHANNELS.COMPANION_RELAY_START,
        async (_event, relayHost: string) => {
            const { startRelayTunnel } = await import('./companion-server');
            return startRelayTunnel(relayHost);
        },
    );

    ipcMain.handle(IPC_CHANNELS.COMPANION_RELAY_STOP, async () => {
        const { stopRelayTunnel } = await import('./companion-server');
        stopRelayTunnel();
    });

    ipcMain.handle(IPC_CHANNELS.COMPANION_RELAY_INFO, async () => {
        const { getRelayTunnelInfo } = await import('./companion-server');
        return getRelayTunnelInfo();
    });

    ipcMain.handle(
        IPC_CHANNELS.COMPANION_TIME_REQUEST_RESPOND,
        async (
            _event,
            payload: { clientId: string; action: 'seen' | 'granted' },
        ) => {
            const { sendTimeRequestAck } = await import('./companion-server');
            sendTimeRequestAck(payload.clientId, payload.action);
        },
    );

    // Companion state push (renderer → main → phone clients via WebSocket)
    ipcMain.on(IPC_CHANNELS.COMPANION_PUSH_PLAYBACK, async (_event, state) => {
        const { pushPlaybackUpdate } = await import('./companion-server');
        pushPlaybackUpdate(state);
    });

    ipcMain.on(IPC_CHANNELS.COMPANION_PUSH_TRACKS, async (_event, tracks) => {
        const { pushTracksUpdate } = await import('./companion-server');
        pushTracksUpdate(tracks);
    });

    ipcMain.on(
        IPC_CHANNELS.COMPANION_PUSH_PARTICIPANTS,
        async (_event, participants) => {
            const { pushParticipantsUpdate } =
                await import('./companion-server');
            pushParticipantsUpdate(participants);
        },
    );

    ipcMain.on(IPC_CHANNELS.COMPANION_PUSH_TURN, async (_event, turnState) => {
        const { pushTurnUpdate } = await import('./companion-server');
        pushTurnUpdate(turnState);
    });

    ipcMain.on(
        IPC_CHANNELS.COMPANION_PUSH_SESSION_SNAPSHOT,
        async (_event, snapshot) => {
            const { pushSessionSnapshot } = await import('./companion-server');
            pushSessionSnapshot(snapshot);
        },
    );
}
