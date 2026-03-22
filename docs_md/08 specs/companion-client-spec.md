# Companion Client Implementation Spec

#architecture/companion #specs

> Phone browser companion for WhatNext sessions — view-only with reactions and time requests.

## Overview

The companion client enables phone participation in WhatNext sessions without installing anything. The coordinator's Electron app serves a mobile web page over local WiFi that mirrors the session state in real-time.

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

## Join Flow

1. Coordinator starts session in Electron app
2. Renderer calls `window.electron.companion.start()` → IPC → main boots HTTP + WS server on port 0
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

RxDB lives in the renderer process. The companion server runs in the main process. The `useCompanionBridge` hook bridges them:

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

### Future (Remote via Relay)
- WebSocket traffic could be tunneled through the libp2p relay
- Session tokens or short-lived invite codes for auth
- Rate limiting on reactions and time requests
- Consider TLS for relay-proxied connections

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

---

## Future Enhancements

- **Remote access via relay**: Proxy WebSocket through libp2p relay for cross-network participation
- **QR code component**: Desktop UI component displaying scannable QR with local URL
- **Richer interactions**: Track suggestions, voting, comments
- **Participant auth**: Tie phone client to WhatNext user identity
- **PWA support**: Add manifest + service worker for "Add to Home Screen"
- **Push notifications**: Alert participants when their turn arrives (requires service worker)
