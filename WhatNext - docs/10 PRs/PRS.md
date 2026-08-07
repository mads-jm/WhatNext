---
tags:
  - index
---

# Pull Requests

PR history and merge records, written on merge per [[workflow-story-to-pr]]. Newest first.

## 2026-08-02 — wave-1 batch (mvp)

Five branches merged as a batch after Governor→Architect→Inspector cycle review; independent pre-merge review in [[report-260801-mvp-premerge-review]].

- [[pr-54-replication-reliability]] — #54: durable checkpoints, relay reconnection, and a convergent LWW tie-break for RxDB-over-libp2p replication (wire format unchanged)
- [[pr-53-downloader-hardening]] — #53: backend-execution test harness for yt-dlp/spotDL/Spytify plus per-backend executable-path config; fixes the dead spotDL input-type path
- [[pr-52-spotify-resilience]] — #52: typed Spotify error taxonomy, resilient fetch with loop-free 401 refresh, and the `spotify:playback-degraded` event bridge
- [[pr-51-manual-track-source]] — #51: un-stubs the Manual TrackSource through a shared, tested normalize→write track sink
- [[pr-55-eslint-config-mjs]] — #55: renames the ESLint flat config to `.mjs` so lint actually loads (merged first to unblock the lanes)

## 2026-03-15 — remote P2P milestone (mvp)

- [[pr-35-test-peer-protocols]] — #35: test peer becomes a full protocol participant with handshake/replication handlers and interactive session commands
- [[pr-34-remote-session-pairing]] — #34: remote session pairing via circuit relay, replication wired to sessions, co-host model and playback mutex
