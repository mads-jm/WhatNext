---
tags:
  - index
---

# Specs

Feature and component specifications.

## Design specs

- [[audio-acquisition-service]] — Unified design spec for local file import and cloud playlist download: schema migration, pluggable backends, artist attribution. *Implemented (Phases A–F shipped).*
- [[companion-client-spec]] — Phone-browser companion for sessions: WebSocket protocol, join flow, reconnection, state bridge. *Server + viewing live; bidirectional control open (#39).*
- [[local-file-import-adapter]] — Local file import adapter. *Superseded — absorbed into [[audio-acquisition-service]] Phase A, which has shipped.*
- [[p2p-session-pairing-spec]] — Shipped spec for remote session pairing: relay connectivity, replication wiring, co-host/playback mutex.

## Epics — wave 1 (from the 2026-06-27 state-of-the-union audit)

- [[epic-app-reliability-quality]] — Error boundaries, StrictMode, `useSessionData` extraction, E2E and service-layer tests, packaging smoke-test. *Partially done: #26 closed 2026-08-06; #49/#50/#48/#22 open.*
- [[epic-audio-acquisition-hardening]] — Backend-execution tests and custom binary paths for the download backends. *Shipped — PR #53 (2026-08-01).*
- [[epic-replication-reliability]] — Durable checkpoints, timeout/backoff, skew-aware LWW, fileshare backpressure, P2P test suite. *Shipped — PR #54 (2026-08-01).*
- [[epic-session-coordination]] — Playback mutex, idempotent turn advancement, bidirectional companion control. *Partially superseded — mutex post-MVP; #43/#39 live.*
- [[epic-spotify-resilience]] — Spotify error taxonomy, retry/backoff, degraded Premium mode, OAuth integration tests. *Shipped — PR #52 (2026-08-01).*
- [[epic-track-sourcing]] — Finish the stubbed manual and P2P track-source arms. *Shipped — PR #51 (2026-08-01); the P2P arm (#38) remains stubbed by design.*

## Epics — wave 2 (from the 2026-08-01 pre-merge review)

- [[epic-file-transfer-guards]] — Inbound P2P file-transfer authorization: reject unsolicited chunks, honor sharing state, fix the cancel slot leak. *Complete.*
- [[epic-handshake-stabilization]] — Break the handshake reply loop and replication pull storm; test-peer LWW parity. *Complete — live 2-peer QA pending.*
- [[epic-ipc-trust-boundary]] — Renderer→main IPC validation: shell/exec, `wn-art://`, `file:write`, downloader argv hygiene. *Complete.*
- [[epic-quality-gates]] — Green lint/typecheck gates and the `ws` CVE lockfile bump. *Complete.*
- [[epic-session-liveness-fixes]] — Downloader truthfulness (#56/#57), sync-loop deadlock, companion auth, honest playback ownership. *Complete — live companion/2-peer QA pending.*
