---
tags:
  - architecture/companion
  - core/sessions
---

# Companion Client

## What It Is

A lightweight web page served by the coordinator's Electron main process over local WiFi (and eventually via relay). Participants open it on their phone browser to view and interact with an active session without installing anything.

> ⚠️ **Reliability status (2026-06-27)** — the **server + snapshot/playback viewing path is live**, but the **phone→server control path below is stubbed** (see [[report-260627-mvp-state-of-the-union]] §3, issue N4). Specifically: `reaction` and `time-request` messages are defined in the protocol but not wired into app logic, and the renderer bridge `useCompanionBridge.ts` was orphaned/never imported ([[dead-code-audit-260322]]) and **deleted 2026-08-06** (commit `ad6a117`; recovery ref `fe94fa6:app/src/renderer/hooks/useCompanionBridge.ts` — #39's implementer starts from [[companion-client-spec]], not the hook). Treat the "Phone → Server" rows and the "renderer pushes" pattern below as **designed-but-not-yet-functional.**

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
2. Desktop displays QR code and the join PIN: `http://192.168.x.x:{port}/#pin=WXYZ`
3. Participant scans QR → phone loads `index.html` with [[Tailwind]] CDN + vanilla JS
4. Participant enters display name (the PIN rides in the link) → WebSocket connects → host validates the PIN → server sends `join:ack` + `session:snapshot`
5. Renderer pushes state changes (playback, tracks, participants) to main via IPC → main fans out to all WebSocket clients
6. Phone → server: reactions, time requests, heartbeats

### Key Message Types

| Direction | Message | Purpose |
|-----------|---------|---------|
| Server → Phone | `session:snapshot` | Full state on connect/reconnect |
| Server → Phone | `playback:update` | Now playing (every 3s) |
| Server → Phone | `tracks:update` | Queue changes |
| Server → Phone | `reaction:broadcast` | Someone reacted |
| Server → Phone | `join:ack` / `join:denied` | Join accepted (with reconnect token) or refused with a reason |
| Phone → Server | `join` | Display name + join PIN + reconnect token; triggers snapshot |
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

- **Renderer pushes, main broadcasts**: Main process has no [[RxDB]] access, so a renderer bridge hook subscribes to RxDB changes and pushes them to main via `ipcRenderer.send()`. Main fans out to WebSocket clients. *(The `useCompanionBridge` implementation of this was deleted 2026-08-06, never having been imported; the pattern stands and will be rebuilt for #39.)*
- **Cached snapshot**: The server caches the last full snapshot so new/reconnecting clients get state instantly.
- **Heartbeat + exponential backoff**: Phone sends heartbeat every 15s. On disconnect, reconnects with backoff (1s, 2s, 4s, max 10s). After reconnect, re-sends `join` — PIN *and* token — to reclaim its identity and get a fresh snapshot.
- **Identity outlives the socket, the roster does not**: a dropped client leaves the roster immediately but its id + token are parked for 5 minutes, so a suspended tab that comes back is the same participant rather than a second one.
- **Debounced pushes**: Track and participant updates are debounced (500ms) to avoid flooding during bulk imports.
- **Progress interpolation**: Phone client interpolates the progress bar locally at 100ms intervals between server updates, giving smooth movement.

## Common Pitfalls

- **Tab suspension**: Mobile browsers aggressively suspend background tabs. The WebSocket *will* die. Design assumes reconnection is the norm, not the exception.
- **Port conflicts**: Server binds to port 0 (OS-assigned) to avoid collisions with Vite (1313) or relay (4001/4002).
- **Path resolution**: `companion-web/` static files must be found in both dev (`src/companion-web/`) and packaged (`resources/companion-web/`) builds.
- **Reachability is not a credential**: joining needs the session **join PIN**, checked host-side on both transports. Being on the Wi-Fi, or holding the public relay session code, is not enough. The PIN travels in the URL *fragment* so a scanned QR is still a one-step join while the credential never reaches the relay (fragments aren't sent to servers). Ten wrong PINs freeze *new* joins for a minute — a phone holding a valid reconnect token is exempt, or one guest's typos would bounce every other phone off the session at its next background reconnect.
- **A display name is not an identity**: a returning phone is recognised by its per-client **reconnect token**, never by name. Adopting whoever typed the same name merged two guests into one participant; the same bug in reverse let anyone wear the HOST badge by typing the host's name. **No phone is host in Phase 1** — a host has the desktop in front of them.
- **A refused join must be visible**: the phone stays on the join screen until `join:ack` arrives, and renders `join:denied` (wrong PIN / locked out) plus a no-answer timeout. Silently switching to an empty session screen is indistinguishable from a broken session.
- **The relay serves the phone UI too**: a relay running an old `relay/companion-web/` hands out a pre-PIN client that can never join. Deploy the relay's copy with the app even when the host↔relay wire contract is unchanged; both static servers send `Cache-Control: no-store` so a stale phone can at least reload out of it.
- **Two hand-maintained copies of the phone UI**: `app/src/companion-web/` (LAN) and `relay/companion-web/` (relay) are duplicates with no sync script — every phone-UI change must land twice. `relay/__tests__/companion-web-parity.test.mjs` fails the suite on drift; the real fix is de-duplication (re-ticketed). Known debt.
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
- `app/src/renderer/hooks/useCompanionBridge.ts` — renderer state bridge *(deleted 2026-08-06; recovery ref `fe94fa6:app/src/renderer/hooks/useCompanionBridge.ts`)*
