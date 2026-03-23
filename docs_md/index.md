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
| `07 stories/` | [[STORIES]] | Vision documents and narratives |
| `08 specs/` | [[SPECS]] | Feature and component specs (linked from Issues) |
| `09 PRs/` | [[PRS]] | PR history (auto-generated on merge) |

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

---

## Active Development Status (2026-03-15)

- ✅ P2P networking foundation (libp2p integration)
- ✅ RxDB replication over libp2p
- ✅ Spotify adapter (import + playback)
- ✅ Sessions v1 (provider-abstracted — [[adr-260307-session-architecture-provider-abstraction]])
- ✅ Social features (reactions, comments, turn-taking)
- ✅ Remote sessions via circuit relay + DCUtR ([[adr-260315-p2p-session-pairing]])
- ✅ RxDB replication wired to sessions (useSessionReplication hook)
- ✅ Co-host model + playback mutex (coHostIds, playbackOwnerId)
- ✅ Companion client — phone browser session viewer ([[Companion-Client]], [[companion-client-spec]])
- 🔜 Open metadata enrichment (MusicBrainz/ListenBrainz)
- 🔜 Non-Spotify track sources (ManualTrackSource, P2PTrackSource)
- 📋 Local file import adapter spec'd ([[local-file-import-adapter]], [[tapec-integration-analysis]])
- 📋 Audio acquisition service spec'd ([[audio-acquisition-service]]) — merged local import + cloud download with pluggable backends (yt-dlp, spotDL, Spytify) and artist purchase link attribution

---

## Recent Architecture Decisions

- [[adr-260315-companion-client-architecture]] — Phone companion: Electron-served HTTP + WebSocket for zero-install mobile session participation (2026-03-15)
- [[adr-260315-p2p-session-pairing]] — Remote pairing: circuit relay + DCUtR, user-configured relay, invite URL, playback mutex (2026-03-15)
- [[adr-260307-session-architecture-provider-abstraction]] — Sessions are platform-agnostic; TrackSource/PlaybackProvider abstraction (2026-03-07)

---

__Last Updated__: 2026-03-22
__Documentation Version__: v0.4.2


