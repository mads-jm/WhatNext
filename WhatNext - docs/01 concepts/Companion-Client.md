# Companion Client

#architecture/companion #p2p/companion

## What It Is

A lightweight web page served by the coordinator's Electron main process over local WiFi (and eventually via relay). Participants open it on their phone browser to view and interact with an active session without installing anything.

## Why We Use It

Running libp2p in a mobile browser is fragile — WebRTC connections die when the phone app-switches between browser and Spotify. A simple HTTP + WebSocket server in the Electron main process gives us:

- **Zero friction join**: scan QR, enter name, done
- **App-switch resilience**: WebSocket reconnects seamlessly after tab suspension
- **No external infrastructure**: the coordinator's desktop serves everything
- **User sovereignty**: no data leaves the local network (MVP)

## How It Works

```
Phone Browser ←→ WebSocket ←→ HTTP Server (Electron Main) ←→ IPC ←→ Renderer (RxDB + Spotify polling)
```

1. Coordinator starts a session → `companion:start` IPC boots an HTTP + WS server on a dynamic port
2. Desktop displays QR code: `http://192.168.x.x:{port}/session`
3. Participant scans QR → phone loads `index.html` with Tailwind CDN + vanilla JS
4. Participant enters display name → WebSocket connects → server sends `session:snapshot`
5. Renderer pushes state changes (playback, tracks, participants) to main via IPC → main fans out to all WebSocket clients
6. Phone → server: reactions, time requests, heartbeats

### Key Message Types

| Direction | Message | Purpose |
|-----------|---------|---------|
| Server → Phone | `session:snapshot` | Full state on connect/reconnect |
| Server → Phone | `playback:update` | Now playing (every 3s) |
| Server → Phone | `tracks:update` | Queue changes |
| Server → Phone | `reaction:broadcast` | Someone reacted |
| Phone → Server | `join` | Display name, triggers snapshot |
| Phone → Server | `reaction` | Emoji + trackId |
| Phone → Server | `time-request` | Request coordinator rewind 30s |
| Phone → Server | `heartbeat` | Every 15s keepalive |

## Key Patterns

- **Renderer pushes, main broadcasts**: Main process has no RxDB access, so the renderer's `useCompanionBridge` hook subscribes to RxDB changes and pushes them to main via `ipcRenderer.send()`. Main fans out to WebSocket clients.
- **Cached snapshot**: The server caches the last full snapshot so new/reconnecting clients get state instantly.
- **Heartbeat + exponential backoff**: Phone sends heartbeat every 15s. On disconnect, reconnects with backoff (1s, 2s, 4s, max 10s). After reconnect, re-sends `join` to get a fresh snapshot.
- **Debounced pushes**: Track and participant updates are debounced (500ms) to avoid flooding during bulk imports.
- **Progress interpolation**: Phone client interpolates the progress bar locally at 100ms intervals between server updates, giving smooth movement.

## Common Pitfalls

- **Tab suspension**: Mobile browsers aggressively suspend background tabs. The WebSocket *will* die. Design assumes reconnection is the norm, not the exception.
- **Port conflicts**: Server binds to port 0 (OS-assigned) to avoid collisions with Vite (1313) or relay (4001/4002).
- **Path resolution**: `companion-web/` static files must be found in both dev (`src/companion-web/`) and packaged (`resources/companion-web/`) builds.
- **No auth for MVP**: Anyone on the local network can connect. Acceptable for MVP (LAN trust), needs addressing for remote relay mode.

## Related Concepts

- [[Sessions]] — the session state model this mirrors
- [[libp2p]] — P2P layer for desktop-to-desktop; companion is the phone-accessible alternative
- [[adr-260315-companion-client-architecture]] — decision record for this approach

## References

- `app/src/main/companion/companion-server.ts` — HTTP + WebSocket server
- `app/src/main/companion/companion-protocol.ts` — message types
- `app/src/companion-web/` — mobile web UI
- `app/src/renderer/hooks/useCompanionBridge.ts` — renderer state bridge
