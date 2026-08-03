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
| `join:ack` | `{ reconnectToken }` | Join accepted; the token is this phone's identity |
| `join:denied` | `{ reason: 'invalid-pin' \| 'locked-out', retryAfterMs }` | Join refused — the phone renders the reason |

### Phone → Server

| Type | Payload | Notes |
|------|---------|-------|
| `join` | `{ displayName, pin, reconnectToken }` | `pin` required; `reconnectToken` null on a first join |
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
| 3 | Phones open `WS /ws/{code}` (no relay-level credential) | Attached as phones |

Phones present the **join PIN in the `join` message**, which the *host* checks — the relay has no participant-auth code at all and never validates anything. That was deliberate: it keeps the relay a dumb pipe, so shipping participant auth needed no second lockstep deploy of the wire contract.

**What the relay can still see**: it forwards phone↔host frames as plaintext JSON, so a *malicious* relay could read a join PIN or a reconnect token out of the traffic it carries. That is unchanged by this work and consistent with the trust model below — the relay is trusted by configuration; the adversary is a third party who learns the public session code. Keeping the PIN out of the *URL* (fragment, not path or query) is what stops it landing in access logs and browser history.

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
2. Renderer calls `window.electron.companion.start()` → [[Electron-IPC|IPC]] → main boots HTTP + WS server on port 0 and **mints the session's join PIN**
3. Server returns `{ port, localIp, joinPin }` → renderer displays QR code, URL, and the PIN
4. Participant scans QR → phone loads `index.html` with the PIN already in the link
5. Participant enters display name (stored in `localStorage`); the PIN field appears **only** when the link carried no PIN (manual URL entry)
6. Phone connects to WebSocket, sends `{ type: 'join', displayName, pin, reconnectToken }`
7. Host validates the PIN and answers `join:ack` (with the phone's reconnect token) or `join:denied` — the phone stays on the join screen until it is let in
8. Server registers client, sends `session:snapshot`, notifies coordinator via IPC
9. Coordinator sees participant in roster UI

### Join PIN

- **4 characters** over the ambiguity-free 32-symbol alphabet `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (≈1.05M combinations), folded case-insensitively (and whitespace-tolerantly) on input.
  *Amends the epic's original "4 digits": same generator shape and same one-step scan, 105× the guess space.* The alphabet is hand-mirrored from `relay/companion-tunnel.mjs`'s session-code generator — a second mirrored constant in the same family as the tunnel envelope; keep them in step.
- **One PIN per companion-server run**, covering both transports. It is minted at `companion:start` and cleared at `companion:stop`.
- **Validation is host-side only**, in `companion-server.ts`, on both the LAN `case 'join'` and the relay `handleRelayPhoneMessage` path. The relay is untouched — it neither mints nor checks the PIN.
- **The PIN rides in the URL *fragment*** (`…/s/ABC234#pin=WXYZ`, `http://192.168.x.x:port/#pin=WXYZ`). Fragments are never sent to a server, so the credential stays out of relay access logs while a scanned QR is still a one-step join. Built at two sites: `CompanionSharePanel.tsx` (LAN) and `companion-server.ts` (relay) — keep them in step.
- **Lockout**: 10 failed attempts in a session freeze *new* joins for 60s; the refusal carries `retryAfterMs` so the phone can say how long. The counter is session-level, not per socket (a phone gets a new socket on every reconnect, so per-socket counters would reset for free) and resets on any successful join.
- **The lockout does not apply to a phone holding a valid reconnect token** (live in `clients`, or in the 5-minute grace list, on the same transport). It has already cleared the PIN gate once this session, so it is not the brute-forcer the lockout is aimed at. Without this exemption one guest's typos would eject every *other* phone in the session the moment its socket bounced — which mobile sockets do constantly — with a message blaming them for PINs they never typed. The PIN is still verified on every join; only the session-wide freeze is waived. The phone-facing copy is phrased about the session ("this session paused new joins…"), not about the phone that sees it.
  *Accepted trade-off*: session-level counting means someone who can reach the session can also keep *new* joins locked out by burning attempts — a nuisance, not a compromise, and the alternative (per-socket counters) does not actually rate-limit anything. A phone whose grace window has expired (>5 min away) is a new joiner again and is subject to the freeze.
- **No host claim**: `join:ack` no longer carries `isHost`, and no phone can become host. A host has the desktop in front of them; the display-name check that granted the HOST badge to anyone who typed the host's name is gone from both paths.

---

## Reconnection Strategy

**Problem**: Phone browsers suspend background tabs. When user switches to Spotify app and back, the WebSocket connection dies.

**Solution**:
- Phone detects `ws.onclose` → schedules reconnect with exponential backoff: 1s, 2s, 4s, max 10s
- On reconnect, re-sends `join` with the stored `displayName`, PIN, **and its reconnect token**
- Server recognises the returning client by **token**, never by display name → reuses the client identity. Two guests called "Sam" are two participants.
- Server sends fresh `session:snapshot` → phone UI fully restores
- Connection status indicator: green (connected), yellow (reconnecting), red (disconnected)

### Reconnect token

- Minted per client on a successful join, returned in `join:ack`, stored in phone `localStorage` under `wn-companion-token:{host}{path}` (one session per key). Clearing site data loses the identity — acceptable and reversible: the phone simply joins as a new participant.
- **Bound to its transport.** A LAN socket cannot adopt a relay-tunnelled phone's identity with its token, and vice versa; the phone gets a fresh identity instead.
- **Relay reconnects are defined, not incidental.** A reconnecting phone arrives on a brand-new relay slot (`phone-N`); presenting its token re-points routing at the new slot and keeps the participant id, instead of churning the roster with a new `relay:{phoneId}` every time. Host-side lookups for tunnelled clients therefore key on the *current* `relayPhoneId`, not on the map key — which also means a late `phone:disconnect` for the abandoned slot correctly drops nobody.
- **Departed identities are held for 5 minutes.** A dropped client leaves `clients` immediately (the roster must not show ghosts) but its id + token are parked in a bounded grace list for the same window the heartbeat monitor uses, so a suspended tab that returns is still itself.

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
- Server binds to `0.0.0.0` — reachable by any device on the same network, so reachability is not a credential: a join needs the PIN
- Path traversal prevention on static file serving
- Phone UI is served `Cache-Control: no-store` on **both** static servers. A phone holding a cached pre-PIN `companion.js` sends no PIN, is refused, and cannot self-heal; not caching stops that recurring.

### Relay tunnel (remote)

**Trust model**: the relay is a *trusted* component — reaching it requires deliberate configuration (free-text host, persisted as `wn-companion-relay-host`). The in-scope adversary is a third party who learns the public session code, **not** the relay operator. There is no end-to-end encryption between app and phone; the relay holds and compares the host credential in plaintext memory.

- **Host authentication (done)**: 256-bit host token minted per session, presented as a bearer header, constant-time compared. See *Relay Tunnel* above.
- **Participant authentication (done, cycle 2b)**: join PIN checked host-side on both transports, host-side join lockout, per-client reconnect token replacing display-name adoption, display-name host claim removed. See *Join Flow* and *Reconnection Strategy* above.
- **Accepted risk — the lockout exemption is deliberately unbounded** (arbitrated 2026-08-02). A phone holding a valid, transport-matched reconnect token skips the join freeze indefinitely and is never itself frozen out, so a token holder could in principle guess PINs without limit while the freeze it triggers still applies to everyone else. This is accepted rather than bounded because **the attack is dominated on its own terms**: the `join` frame carries `pin` and `reconnectToken` *together, in plaintext*, so every channel that could yield someone else's token yields the PIN in the same frame — a compromised relay reads both, LAN sniffing without TLS reads both, and the shared-device route (`localStorage`) also exposes the `#pin=` fragment through the browser's own history and open tab. An attacker who can obtain a token therefore never needs to guess the PIN, which makes a per-identity attempt counter a guard on a path no realistic attacker takes. Weighed against a defect that fired for every honest guest on ordinary mobile network behaviour, the exemption is the better trade.
  **Tripwire — revisit if either of these changes**: (a) a token holder is ever allowed to join *without* presenting the PIN, or (b) TLS lands and the token stops being co-observable with the PIN. Either breaks the domination argument, and the fix to reach for is a per-identity failed-PIN counter bounding the exemption. Re-ticketed alongside TLS and the `companion-web` dedup; do not act on it before then.
- **Deployment note**: the phone client is served by the relay for tunnelled phones, so a relay running the old `companion-web/` serves phones that cannot join (no PIN in their `join`). Deploy `relay/companion-web/` with the app even though the host↔relay *wire contract* is unchanged.
- Still open: TLS, rate limiting on reactions and time requests, session-code entropy, CORS tightening, `/session/:code/status` information disclosure, a *credentialed* host-phone claim (re-ticket only if the HOST badge is missed), and the narrow post-upgrade rejection race when the host's own token is wrong (host-side; re-ticketed).

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
| `relay/companion-tunnel.mjs` | Relay-side tunnel: host auth + per-phone addressing; static files `no-store` |
| `relay/companion-web/` | Hand-mirrored copy of the phone UI (see below) |

### Keeping the two phone-UI copies in step

`app/src/companion-web/` and `relay/companion-web/` are byte-identical duplicates with no build step between them. Until the de-duplication ticket lands:

- **Automatic**: `relay/__tests__/companion-web-parity.test.mjs` checksums both directories and fails `npm test` on drift. It reports *that* they diverged, nothing more.
- **Manual**: `diff -ru app/src/companion-web relay/companion-web`, then `cp` in whichever direction is correct.

---

## Future Enhancements

- **Remote access via relay**: Proxy WebSocket through the [[Circuit-Relay|libp2p relay]] for cross-network participation
- **QR code component**: Desktop UI component displaying scannable QR with local URL
- **Richer interactions**: Track suggestions, voting, comments
- **Participant identity**: tie the phone client to a WhatNext user identity (the reconnect token is device-scoped, not account-scoped)
- **PWA support**: Add manifest + service worker for "Add to Home Screen"
- **Push notifications**: Alert participants when their turn arrives (requires service worker)
