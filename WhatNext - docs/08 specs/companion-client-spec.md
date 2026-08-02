---
tags:
  - specs/sessions
  - architecture/companion
  - core/sessions
---

# Companion Client Implementation Spec

> Phone browser companion for WhatNext sessions — view-only with reactions and time requests.

## Overview

The companion client enables phone participation in WhatNext [[Sessions|sessions]] without installing anything. The coordinator's Electron app serves a mobile web page over local WiFi that mirrors the session state in real-time.

**ADR**: [[adr-260315-companion-client-architecture]]
**Concept**: [[Companion-Client]]

---

## WebSocket Protocol

All messages are JSON. Connection endpoint: `ws://{host}:{port}/ws`

### Server → Phone

| Type | Payload | When |
|------|---------|------|
| `session:snapshot` | `{ sessionName, playback, tracks, participants, turn }` | On connect / reconnect |
| `playback:update` | `{ isPlaying, trackId, progressMs, durationMs, title, artists, albumArtUrl }` | Every 3s from Spotify poll |
| `tracks:update` | `{ tracks: [{ id, title, artists, album, durationMs, albumArtUrl, addedBy }] }` | Track list changes |
| `participants:update` | `{ participants: [{ id, displayName, avatarUrl, isHost, isCoHost }] }` | Join / leave |
| `turn:update` | `{ currentTurn, effectiveTurnIndex, mode }` | Turn changes |
| `reaction:broadcast` | `{ clientId, displayName, emoji, trackId }` | Any client reacts |
| `time-request:ack` | `{ status: 'seen' \| 'granted' }` | Coordinator responds |

### Phone → Server

| Type | Payload | Notes |
|------|---------|-------|
| `join` | `{ displayName }` | Triggers snapshot response |
| `reaction` | `{ emoji, trackId }` | Broadcast to all clients + coordinator |
| `heartbeat` | `{}` | Every 15s |
| `time-request` | `{ trackId }` | Forwarded to coordinator as IPC event |

---

## Relay Tunnel (remote access)

When the phone cannot reach the coordinator's LAN, the Electron host opens an **outbound** WebSocket to the companion tunnel on the relay (`relay/companion-tunnel.mjs`), and phones connect to the relay instead of to the desktop.

```
Phone ──WS──► Relay (public) ◄──WS── Electron host (outbound)
```

### Host attach handshake

| Step | Call | Result |
|------|------|--------|
| 1 | Host `POST /session` | `{ code, hostToken, tunnelProtocolVersion }` |
| 2 | Host opens `WS /host/{code}` with `Authorization: Bearer {hostToken}` | Attached as host |
| 3 | Phones open `WS /ws/{code}` (no credential — see cycle 2b) | Attached as phones |

- The **session code is public** — it is in the phone URL (`/s/{code}`) and the QR payload. The **host token is not**: it is returned once, to its creator, held only in the host process, sent only as a request header, and never logged.
- Possession of the code alone does **not** permit attaching as the host. A host WebSocket with a missing or wrong credential is closed with **4003 Unauthorized** *before* the relay touches the session's host slot, so a rejected impostor cannot displace or disturb the attached host. (Before this handshake existed, any socket reaching `/host/{code}` replaced the live host — full remote session hijack.)
- The credential is compared in constant time.
- **Fail closed on version skew**: if `POST /session` returns no `hostToken`, the relay is older than the app and the host **refuses to open the tunnel**, surfacing an error that names the relay/app mismatch. There is no unauthenticated fallback. Deploying this change therefore requires updating **relay and app together**.
- Close codes `4001` (session not found) and `4003` (unauthorized) are terminal: the host stops its reconnect backoff instead of retrying forever. Any other close (transport drop) re-attaches with the same credential and re-sends the cached snapshot.

### Host ↔ relay envelope (v1)

Host↔relay frames are wrapped so individual phones are addressable. **Phone↔relay frames are unchanged raw companion JSON** — the phone web client knows nothing about the envelope.

| Direction | Frame |
|-----------|-------|
| Host → relay | `{ v: 1, type: 'host:message', to: phoneId \| null, payload }` |
| Relay → host | `{ v: 1, type: 'phone:message', from: phoneId, payload }` |
| Relay → host | `{ v: 1, type: 'phone:disconnect', from: phoneId }` |

- `to: null` fans the payload out to every phone; a phone id delivers to that phone only. `time-request:ack` is always addressed, so phones that did not ask for time no longer receive one.
- The relay assigns each phone an id (`phone-N`) and tags everything it forwards, so two phones on one tunnel are distinguishable at the host.
- Tunnelled phones are registered in the host's `clients` map as `relay:{phoneId}`, so client counts, `companion:client-left`, and per-client sends work identically on both transports.
- Frames that are not well-formed v1 envelopes are dropped by both sides — no silent legacy fallback.

Types live in `app/src/main/companion/companion-protocol.ts` and are hand-mirrored in `relay/companion-tunnel.mjs` (the relay is a separate JS package and cannot import them).

---

## Join Flow

1. Coordinator starts session in Electron app
2. Renderer calls `window.electron.companion.start()` → [[Electron-IPC|IPC]] → main boots HTTP + WS server on port 0
3. Server returns `{ port, localIp }` → renderer displays QR code with URL
4. Participant scans QR → phone loads `index.html`
5. Participant enters display name (stored in `localStorage` for reconnection)
6. Phone connects to WebSocket, sends `{ type: 'join', displayName }`
7. Server registers client, sends `session:snapshot`, notifies coordinator via IPC
8. Coordinator sees participant in roster UI

---

## Reconnection Strategy

**Problem**: Phone browsers suspend background tabs. When user switches to Spotify app and back, the WebSocket connection dies.

**Solution**:
- Phone detects `ws.onclose` → schedules reconnect with exponential backoff: 1s, 2s, 4s, max 10s
- On reconnect, re-sends `join` with stored `displayName`
- Server recognizes returning client by `displayName` match → reuses client identity
- Server sends fresh `session:snapshot` → phone UI fully restores
- Connection status indicator: green (connected), yellow (reconnecting), red (disconnected)

**Heartbeat**:
- Phone sends `heartbeat` every 15s
- Server marks client "away" after 2 missed heartbeats (30s)
- Server removes client after 5 minutes of silence
- Client removal triggers `companion:client-left` IPC event to coordinator

---

## State Bridge Architecture

[[RxDB]] lives in the renderer process. The companion server runs in the main process. The `useCompanionBridge` hook bridges them:

```
RxDB (renderer) → useCompanionBridge hook → ipcRenderer.send() → main process → WebSocket broadcast
```

### Observed Collections

| Collection | Trigger | Debounce | Push Method |
|------------|---------|----------|-------------|
| `playlists` | Track list changes | 500ms | `companion:push-tracks` |
| `tracks` | Track metadata changes | 500ms | `companion:push-tracks` |
| `users` | Participant join/leave | 500ms | `companion:push-participants` |
| (Spotify poll) | Playback state | None (already 3s interval) | `companion:push-playback` |

### IPC Channels

**Renderer → Main (invoke)**:
- `companion:start` → `{ port, localIp }`
- `companion:stop` → void
- `companion:get-info` → `{ port, localIp, connectedClients }`
- `companion:time-request-respond` → void

**Renderer → Main (send, fire-and-forget)**:
- `companion:push-playback`
- `companion:push-tracks`
- `companion:push-participants`
- `companion:push-turn`
- `companion:push-session-snapshot`

**Main → Renderer (events)**:
- `companion:client-joined` → `{ clientId, displayName }`
- `companion:client-left` → `{ clientId, displayName }`
- `companion:reaction` → `{ clientId, displayName, emoji, trackId }`
- `companion:time-request` → `{ clientId, displayName, trackId }`

---

## Mobile UI Sections

1. **Join Form**: Name input + join button. Pre-filled from `localStorage`.
2. **Header**: "WN" branding, session name, connection status dot, client count.
3. **Now Playing** (hero): Album art (80x80), track title, artists, progress bar with time interpolation.
4. **Reactions Bar**: 6 emoji buttons (fire, heart, clap, surprised, skull, music note) + "More Time" button.
5. **Queue**: Scrollable track list with art thumbnails, current track highlighted.
6. **Participants**: Horizontal chip list at bottom, host/co-host badges.

### Progress Bar Interpolation

Server sends playback updates every 3s. Between updates, the phone client increments `progressMs` locally at 100ms intervals when `isPlaying === true`. This provides smooth visual progress without extra network traffic.

---

## Security Considerations

### MVP (Local Network Only)
- Server binds to `0.0.0.0` — accessible to any device on the same network
- No authentication beyond display name
- Acceptable for LAN trust model (same WiFi = implicit trust)
- Path traversal prevention on static file serving

### Relay tunnel (remote)

**Trust model**: the relay is a *trusted* component — reaching it requires deliberate configuration (free-text host, persisted as `wn-companion-relay-host`). The in-scope adversary is a third party who learns the public session code, **not** the relay operator. There is no end-to-end encryption between app and phone; the relay holds and compares the host credential in plaintext memory.

- **Host authentication (done)**: 256-bit host token minted per session, presented as a bearer header, constant-time compared. See *Relay Tunnel* above.
- **Participant authentication (cycle 2b)**: phones still join unauthenticated. Planned: join PIN, per-client reconnect token replacing display-name adoption, LAN `isHost` claim.
- Still open: TLS, rate limiting on reactions and time requests, session-code entropy, CORS tightening, `/session/:code/status` information disclosure.

---

## File Inventory

### New Files
| File | Purpose |
|------|---------|
| `app/src/main/companion/companion-server.ts` | HTTP + WebSocket server |
| `app/src/main/companion/companion-protocol.ts` | Message types + serialization |
| `app/src/companion-web/index.html` | Mobile web UI |
| `app/src/companion-web/companion.js` | WebSocket client + DOM updates |
| `app/src/companion-web/companion.css` | Animations + mobile styles |
| `app/src/renderer/hooks/useCompanionBridge.ts` | RxDB → IPC state bridge |

### Modified Files
| File | Changes |
|------|---------|
| `app/src/shared/core/ipc-protocol.ts` | Companion IPC channels + payload types |
| `app/src/main/preload.ts` | `companion` namespace in `window.electron` |
| `app/src/main/main.ts` | IPC handlers + server lifecycle |
| `app/package.json` | `ws` dependency |
| `relay/companion-tunnel.mjs` | Relay-side tunnel: host auth + per-phone addressing |

---

## Future Enhancements

- **Remote access via relay**: Proxy WebSocket through the [[Circuit-Relay|libp2p relay]] for cross-network participation
- **QR code component**: Desktop UI component displaying scannable QR with local URL
- **Richer interactions**: Track suggestions, voting, comments
- **Participant auth**: Tie phone client to WhatNext user identity
- **PWA support**: Add manifest + service worker for "Add to Home Screen"
- **Push notifications**: Alert participants when their turn arrives (requires service worker)
