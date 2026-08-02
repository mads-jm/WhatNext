---
tags:
  - architecture/companion
  - core/sessions
---

# Companion Client

## What It Is

A lightweight web page served by the coordinator's Electron main process over local WiFi (and eventually via relay). Participants open it on their phone browser to view and interact with an active session without installing anything.

> ⚠️ **Reliability status (2026-06-27)** — the **server + snapshot/playback viewing path is live**, but the **phone→server control path below is stubbed** (see [[report-260627-mvp-state-of-the-union]] §3, issue N4). Specifically: `reaction` and `time-request` messages are defined in the protocol but not wired into app logic, and the renderer bridge `useCompanionBridge.ts` is currently **orphaned/never imported** ([[dead-code-audit-260322]]). Treat the "Phone → Server" rows and the "renderer pushes" pattern below as **designed-but-not-yet-functional.**

## Why We Use It

Running [[libp2p]] in a mobile browser is fragile — [[WebRTC]] connections die when the phone app-switches between browser and Spotify. A simple HTTP + WebSocket server in the [[Electron]] main process gives us:

- **Zero friction join**: scan QR, enter name, done
- **App-switch resilience**: WebSocket reconnects seamlessly after tab suspension
- **No external infrastructure**: the coordinator's desktop serves everything
- **User sovereignty**: no data leaves the local network (MVP)

## How It Works

```
Phone Browser ←→ WebSocket ←→ HTTP Server (Electron Main) ←→ IPC ←→ Renderer (RxDB + Spotify polling)
```

1. Coordinator starts a session → `companion:start` [[Electron-IPC|IPC]] boots an HTTP + WS server on a dynamic port
2. Desktop displays QR code: `http://192.168.x.x:{port}/session`
3. Participant scans QR → phone loads `index.html` with [[Tailwind]] CDN + vanilla JS
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

### Remote path: the relay tunnel

When the phone can't reach the desktop's LAN, the host opens an outbound WebSocket to the companion tunnel on the relay and phones connect there instead:

```
Phone ←→ WS ←→ Companion Tunnel (relay) ←→ WS ←→ Electron Main ←→ IPC ←→ Renderer
```

**Host attach is authenticated.** `POST /session` mints a public 6-character session code *and* a secret 256-bit host token. Only a socket presenting `Authorization: Bearer <token>` may attach to `/host/<code>`; anything else is closed with `4003` before the relay touches the host slot, so a rejected impostor can't displace the live host. The token never appears in the phone URL, the QR payload, or relay logs. If the relay mints no token it is an older build, and the app **refuses to open the tunnel** rather than falling back to an unauthenticated one — so relay and app must be deployed together.

**Host↔relay frames are enveloped (v1)** so single phones can be addressed:

| Direction | Frame |
|-----------|-------|
| Host → relay | `{ v, type: 'host:message', to: phoneId \| null, payload }` |
| Relay → host | `{ v, type: 'phone:message', from: phoneId, payload }` / `{ v, type: 'phone:disconnect', from }` |

Phone↔relay traffic stays raw companion JSON — the phone client is unaware of the envelope. `to: null` fans out; a phone id targets one phone, which is how a `time-request:ack` reaches only the phone that asked.

## Key Patterns

- **Renderer pushes, main broadcasts**: Main process has no [[RxDB]] access, so the renderer's `useCompanionBridge` hook subscribes to RxDB changes and pushes them to main via `ipcRenderer.send()`. Main fans out to WebSocket clients.
- **Cached snapshot**: The server caches the last full snapshot so new/reconnecting clients get state instantly.
- **Heartbeat + exponential backoff**: Phone sends heartbeat every 15s. On disconnect, reconnects with backoff (1s, 2s, 4s, max 10s). After reconnect, re-sends `join` to get a fresh snapshot.
- **Debounced pushes**: Track and participant updates are debounced (500ms) to avoid flooding during bulk imports.
- **Progress interpolation**: Phone client interpolates the progress bar locally at 100ms intervals between server updates, giving smooth movement.

## Common Pitfalls

- **Tab suspension**: Mobile browsers aggressively suspend background tabs. The WebSocket *will* die. Design assumes reconnection is the norm, not the exception.
- **Port conflicts**: Server binds to port 0 (OS-assigned) to avoid collisions with Vite (1313) or relay (4001/4002).
- **Path resolution**: `companion-web/` static files must be found in both dev (`src/companion-web/`) and packaged (`resources/companion-web/`) builds.
- **No participant auth yet**: anyone on the local network — or anyone holding the public relay session code — can join as a *phone*. Acceptable under the LAN/trusted-relay model for now; the join PIN and per-client reconnect token are the next slice. The **host** slot is authenticated (above).
- **Two hand-maintained copies of the phone UI**: `app/src/companion-web/` (LAN) and `relay/companion-web/` (relay) are duplicates with no sync script — every phone-UI change must land twice. Known debt.
- **Relay-tunnelled phones are real clients**: they live in the same `clients` map as LAN phones under `relay:{phoneId}`. Addressing them by a constant id (the old `'relay-phone'`) silently broke per-client sends and client counts.

## Related Concepts

- [[Sessions]] — the session state model this mirrors
- [[libp2p]] — P2P layer for desktop-to-desktop; companion is the phone-accessible alternative
- [[Electron-IPC]] — the renderer↔main bridge the state push rides on
- [[adr-260315-companion-client-architecture]] — decision record for this approach
- [[companion-client-spec]] — feature spec for the companion client

## References

- `app/src/main/companion/companion-server.ts` — HTTP + WebSocket server, relay tunnel client
- `app/src/main/companion/companion-protocol.ts` — message types + host↔relay envelope
- `relay/companion-tunnel.mjs` — relay-side tunnel (host auth, per-phone addressing)
- `app/src/companion-web/` — mobile web UI
- `app/src/renderer/hooks/useCompanionBridge.ts` — renderer state bridge
