---
tags:
  - index
---

# Specs

Feature and component specifications.

## Design specs

- [[audio-acquisition-service]] — Unified design spec for local file import and cloud playlist download: schema migration, pluggable backends, artist attribution.
- [[companion-client-spec]] — Phone-browser companion for sessions: WebSocket protocol, join flow, reconnection, state bridge.
- [[local-file-import-adapter]] — Local file import adapter (absorbed into [[audio-acquisition-service]] Phase A).
- [[p2p-session-pairing-spec]] — Shipped spec for remote session pairing: relay connectivity, replication wiring, co-host/playback mutex.

## Epics — wave 1 (from the 2026-06-27 state-of-the-union audit)

- [[epic-app-reliability-quality]] — Error boundaries, StrictMode, `useSessionData` extraction, E2E and service-layer tests, packaging smoke-test.
- [[epic-audio-acquisition-hardening]] — Backend-execution tests and custom binary paths for the download backends.
- [[epic-replication-reliability]] — Durable checkpoints, timeout/backoff, skew-aware LWW, fileshare backpressure, P2P test suite.
- [[epic-session-coordination]] — Playback mutex, idempotent turn advancement, bidirectional companion control.
- [[epic-spotify-resilience]] — Spotify error taxonomy, retry/backoff, degraded Premium mode, OAuth integration tests.
- [[epic-track-sourcing]] — Finish the stubbed manual and P2P track-source arms.

## Epics — wave 2 (from the 2026-08-01 pre-merge review)

- [[epic-file-transfer-guards]] — Inbound P2P file-transfer authorization: reject unsolicited chunks, honor sharing state, fix the cancel slot leak.
- [[epic-handshake-stabilization]] — Break the handshake reply loop and replication pull storm; test-peer LWW parity.
- [[epic-ipc-trust-boundary]] — Renderer→main IPC validation: shell/exec, `wn-art://`, `file:write`, downloader argv hygiene.
- [[epic-quality-gates]] — Green lint/typecheck gates and the `ws` CVE lockfile bump.
- [[epic-session-liveness-fixes]] — Downloader truthfulness (#56/#57), sync-loop deadlock, companion auth, honest playback ownership.
