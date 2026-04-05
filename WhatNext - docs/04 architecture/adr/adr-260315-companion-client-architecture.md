# ADR: Companion Client — Electron-Served HTTP + WebSocket for Phone Participants

**Date**: 2026-03-15
**Status**: Accepted

#architecture/decisions #architecture/companion

## Context

WhatNext sessions need phone participation: friends scanning a QR code to see what's playing, react, and request more time on a track. The coordinator runs the Electron desktop app with Spotify control; participants need a zero-install mobile experience.

Key constraints:
- Must survive phone app-switching (browser ↔ Spotify) — connections will be killed and must reconnect seamlessly
- Must work on any phone browser (Safari, Chrome, Firefox) without native app install
- Local-first: no external server dependency for MVP
- Read-only with lightweight interactions (reactions, time requests)

## Decision

The Electron main process runs a lightweight HTTP + WebSocket server (Node `http` + `ws` npm package) that serves a vanilla JS mobile web UI and pushes session state in real-time.

### Architecture

```
Phone Browser ←→ WebSocket ←→ HTTP + WS Server (Main Process) ←→ IPC ←→ Renderer (RxDB + Spotify)
```

- **HTTP server**: Serves static files from `companion-web/` directory
- **WebSocket**: Bidirectional real-time channel on `/ws`
- **Dynamic port**: OS-assigned (port 0) to avoid conflicts
- **State bridge**: Renderer pushes RxDB/playback changes to main via IPC; main broadcasts to all WebSocket clients
- **Mobile UI**: Vanilla HTML + JS + Tailwind CDN — no React, no build step, < 50KB

### Join Flow

1. Session starts → companion server boots
2. Desktop shows QR code with `http://{localIp}:{port}/session`
3. Phone scans → enters display name → WebSocket connects → receives full snapshot
4. Coordinator sees participant in roster

## Consequences

**Benefits:**
- Zero infrastructure — coordinator's machine serves everything
- User sovereignty preserved — no data leaves the network
- Trivial reconnection — WebSocket reconnect + snapshot is resilient to app-switching
- Fast load — vanilla JS + Tailwind CDN loads in < 1s on WiFi
- Simple protocol — JSON messages over WebSocket, no complex handshake

**Trade-offs:**
- HTTP server in Electron main process increases attack surface (mitigated: LAN only for MVP)
- No auth beyond display name (acceptable for LAN trust model)
- Requires same WiFi network for MVP (remote access deferred to relay integration)
- One more thing to package — `companion-web/` must be included in electron-builder output

## Alternatives Considered

### 1. libp2p in Mobile Browser
- js-libp2p browser bundle is ~200KB+ and requires WebRTC
- WebRTC connections in mobile browsers are fragile and die on tab suspension
- Reconnection requires full ICE negotiation — slow and unreliable
- **Rejected**: too heavy, too fragile for the use case

### 2. Separate Node Server Process
- Run a standalone Express/Fastify server alongside Electron
- Would need its own lifecycle management, port coordination, process monitoring
- Breaks sovereignty model — another process to manage and potentially expose
- **Rejected**: unnecessary complexity for serving 3 static files

### 3. React / Vite Build for Mobile
- Full React app with Vite build step, shared components with desktop
- Overkill for a read-only view with reactions
- Larger bundle, slower load on WiFi, build pipeline complexity
- **Rejected**: over-engineered for the scope

### 4. Server-Sent Events (SSE) Instead of WebSocket
- SSE is one-directional (server → client only)
- Would need a separate REST endpoint for phone → server actions (reactions, time requests)
- Two transport mechanisms instead of one
- **Rejected**: WebSocket covers both directions cleanly

## References

- Related concepts: [[Companion-Client]], [[Sessions]]
- Previous decision: [[adr-260315-p2p-session-pairing]] — P2P pairing for desktop-to-desktop
