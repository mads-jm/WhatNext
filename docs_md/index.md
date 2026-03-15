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
| Session view | `app/src/renderer/components/Session/SessionView.tsx` |
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
- 🔜 Open metadata enrichment (MusicBrainz/ListenBrainz)
- 🔜 Non-Spotify track sources (ManualTrackSource, P2PTrackSource)

---

## Recent Architecture Decisions

- [[adr-260315-p2p-session-pairing]] — Remote pairing: circuit relay + DCUtR, user-configured relay, invite URL, playback mutex (2026-03-15)
- [[adr-260307-session-architecture-provider-abstraction]] — Sessions are platform-agnostic; TrackSource/PlaybackProvider abstraction (2026-03-07)

---

__Last Updated__: 2026-03-15
__Documentation Version__: v0.4.0


