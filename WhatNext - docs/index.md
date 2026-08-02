---
tags:
  - index
date created: Thursday, November 13th 2025, 4:59:12 am
date modified: Monday, March 9th 2026, 12:20:36 am
---

# WhatNext Documentation

> __For LLMs__: Start here. Navigate to a directory index for scoped exploration, or jump directly to a core document below.

---

## Directory Indexes (`00 index/`)

| Directory | Index | Contents |
|-----------|-------|----------|
| `01 concepts/` | [[CONCEPTS]] | Technology & pattern concept pages |
| `03 guides/` | [[GUIDES]] | How-to docs and workflow guides |
| `04 architecture/` | [[ARCHITECTURE]] | SRS, architecture design document |
| `04 architecture/adr/` | [[ADR]] | Architecture Decision Records |
| `05 notes/` | [[NOTES]] | Active development notes |
| `06 reports/` | [[REPORTS]] | State-of-project vettings and audits |
| `07 stories/` | [[STORIES]] | Vision documents and narratives |
| `08 specs/` | [[SPECS]] | Feature and component specs (linked from Issues) |
| `10 PRs/` | [[PRS]] | PR history (auto-generated on merge) |

---

## Core Documents

- __[[whtnxt-nextspec]]__ — Complete technical specification (source of truth)
- __[[srs-whatnext]]__ — Software Requirements Specification (MVP baseline)
- __[[architecture-whatnext]]__ — Architecture Design Document (MVP baseline)
- __[[the-walled-garden-cracks]]__ — Coordinator model and Spotify strategy (Feb 2026)
- __[[workflow-story-to-pr]]__ — Development workflow: Story → Issue → Spec → Commit → PR
- __[[coding-standards]]__ — Coding standards: architecture boundaries, state management, testing, naming
- __[[Theme-System]]__ — CSS Variable Bridge pattern for runtime-switchable themes (Tailwind v4, Electron, cross-platform)
- __[[whtnxt_beyondmvp]]__ — Post-MVP design language, UX drivers, and component patterns from prototype exploration

---

## Quick Reference

### Common Commands

```bash
node scripts/start-dev.mjs              # Start app + test peer
node scripts/start-dev.mjs --app-only   # App only
cd app && npm run typecheck             # TypeScript check
cd app && npm run build                 # Production build
```

### Key File Locations

| Area | File |
|------|------|
| Main process | `app/src/main/main.ts` |
| IPC bridge | `app/src/main/preload.ts` |
| RxDB database | `app/src/renderer/db/database.ts` |
| Schemas | `app/src/renderer/db/schemas.ts` |
| IPC channels + payload types | `app/src/shared/core/ipc-protocol.ts` |
| Portable core types | `app/src/shared/core/types.ts` (ReplicationSink, P2P types) |
| Portable utils | `app/src/renderer/utils/` (turn, artwork, reactions, comments, playback) |
| Session view | `app/src/renderer/components/Session/SessionView.tsx` |
| Companion server | `app/src/main/companion/companion-server.ts` |
| Companion web UI | `app/src/companion-web/index.html` |
| Spotify OAuth | `app/src/main/spotify/spotify-auth.ts` |
| Spotify error taxonomy | `app/src/main/spotify/spotify-errors.ts` (typed `SpotifyApiError` kinds, `Retry-After` parsing) |
| Spotify transport resilience | `app/src/main/spotify/spotify-resilience.ts` (timeout + bounded backoff/retry) |
| Spotify runtime-event bridge | `app/src/main/spotify/spotify-events.ts` (main→renderer `auth-error` / `playback-degraded`) |

---

## Active Development Status (2026-06-27)

> **Reality-checked** against code in [[report-260627-mvp-state-of-the-union]]. Legend: ✅ solid · 🟡 works but fragile/untested · 🟠 stubbed/partial · 🔜 planned. Most features exist; the gap is **reliability and tests**, not features.

- ✅ P2P networking foundation (libp2p: mDNS + circuit relay + DCUtR)
- ✅ Spotify adapter — import + Connect playback (uses only post-lockdown-allowed endpoints)
- 🟡 RxDB replication over libp2p — works, but in-memory checkpoints (resync each launch), 5s silent-timeout drops, string-LWW
- 🟡 Sessions v1 (provider-abstracted — [[adr-260307-session-architecture-provider-abstraction]])
- 🟡 Social features — reactions/comments solid; turn-taking has a concurrent-add race
- 🟡 Remote sessions via circuit relay + DCUtR ([[adr-260315-p2p-session-pairing]]) — no reconnection/fallback
- 🟡 Audio sourcing — local import + yt-dlp + spotDL with infra tests; Spytify Windows-only PoC; P2P fileshare v0 untested ([[audio-acquisition-service]])
- 🟠 Co-host model + playback mutex — `coHostIds`/`playbackOwnerId` are schema fields only; **mutex unimplemented**
- 🟠 Companion client — snapshot viewer works; **bidirectional control stubbed** ([[Companion-Client]], [[companion-client-spec]])
- 🟠 Non-Spotify track sources — Manual & P2P `TrackSource` paths are **no-op stubs** (`useTrackSource.ts:322`)
- ⚠️ **Test coverage near-zero for P2P/replication/playback**; no React error boundaries ([[mvp-reality-react-quality]])
- 🔜 Open metadata enrichment (MusicBrainz/ListenBrainz)
- 📋 Local file import adapter spec'd ([[local-file-import-adapter]], [[tapec-integration-analysis]])

**Next focus**: finish stubbed features (mutex, Manual/P2P sources, companion control), then harden replication + Spotify errors, then tests. Backlog reconciliation: [[report-260627-issue-reconciliation]].

---

## Recent Architecture Decisions

- [[adr-260315-companion-client-architecture]] — Phone companion: Electron-served HTTP + WebSocket for zero-install mobile session participation (2026-03-15)
- [[adr-260315-p2p-session-pairing]] — Remote pairing: circuit relay + DCUtR, user-configured relay, invite URL, playback mutex (2026-03-15)
- [[adr-260307-session-architecture-provider-abstraction]] — Sessions are platform-agnostic; TrackSource/PlaybackProvider abstraction (2026-03-07)

---

__Last Updated__: 2026-06-27
__Documentation Version__: v0.5.0 (post-stale-period reality check)


