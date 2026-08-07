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
| `00 index/` | [[BACKLOG.kanban\|BACKLOG]] | Vault indexes (`.base` files) and the backlog board |
| `01 concepts/` | [[CONCEPTS]] | Technology & pattern concept pages |
| `02 references/` | [[REFERENCES]] | External resource summaries |
| `03 guides/` | [[GUIDES]] | How-to docs and workflow guides |
| `04 architecture/` | [[ARCHITECTURE]] | SRS, architecture design document |
| `04 architecture/adr/` | [[ADR]] | Architecture Decision Records |
| `05 notes/` | [[NOTES]] | Development notes (Nov-2025 timestamped notes archived into concept pages 2026-08-06) |
| `06 reports/` | [[REPORTS]] | State-of-project vettings and audits |
| `07 stories/` | [[STORIES]] | Vision documents and narratives |
| `08 specs/` | [[SPECS]] | Feature and component specs (linked from Issues) |
| `09 milestones/` | [[MILESTONES]] | Development milestone summaries (v0.0.0; v0.1.0 pending) |
| `10 PRs/` | [[PRS]] | PR history (auto-generated on merge) |
| `99 meta/` | — | Templates and vault configuration |

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

## Active Development Status (2026-08-06)

> Legend: ✅ solid · 🟡 works but fragile/untested · 🟠 stubbed/partial · 🔜 planned. Wave 1 (PRs #51–#55) and wave 2 (five hardening epics, committed directly to `mvp`) are both complete; all three quality gates (lint, typecheck, tests) are green and CI runs on every push to `mvp`/`main`. Historical snapshots: [[report-260627-mvp-state-of-the-union]] (pre-wave-1), [[report-260801-mvp-premerge-review]] (wave-1 integration review, verdict NOT YET — its six merge-blockers have all since been closed, see [[report-260804-ipc-trust-boundary-review]] for the READY verification of the trust-boundary half).

- ✅ P2P networking foundation (libp2p: mDNS + circuit relay + DCUtR)
- ✅ Spotify adapter — import + Connect playback (post-lockdown-allowed endpoints only), typed error taxonomy, timeout/backoff resilience (wave 1, PR #52)
- ✅ RxDB replication over libp2p — durable checkpoints, skew-aware LWW, reconnect backoff + liveness heartbeat (wave 1, PR #54); handshake single-stream fix landed (#58, **live 2-peer QA still owed**)
- ✅ Main-process trust boundary — exec branch deleted, artwork/file-write/open-path containment, downloader argv hygiene ([[epic-ipc-trust-boundary]], verified READY in [[report-260804-ipc-trust-boundary-review]])
- ✅ P2P file transfer v0 — chunk/serve guards, manifest-time sharing authorization, receive-path lifecycle hardening ([[epic-file-transfer-guards]]; accepted limitation: served files fail closed after host restart)
- 🟡 Sessions v1 (provider-abstracted — [[adr-260307-session-architecture-provider-abstraction]]); turn-taking still has a concurrent-add race (#43)
- 🟡 Audio sourcing — local import + yt-dlp + spotDL hardened with backend tests ([[epic-audio-acquisition-hardening]]); open bugs: batch stranding #63, spotDL output drift #64; Spytify Windows-only PoC
- 🟡 Manual `TrackSource` — implemented (wave 1, PR #51); P2P `TrackSource` arm remains stubbed (#38)
- 🟡 Companion client — snapshot viewer + PIN join, reconnect tokens, host-authed relay tunnel ([[epic-session-liveness-fixes]]; **BREAKING relay+app lockstep deploy pending live QA**); **bidirectional control still stubbed** ([[companion-client-spec]], #39)
- 🔜 Co-host model + playback mutex — **post-MVP.** Playback is device-local by design; the dead ownership UI was removed 2026-08-03 rather than relabelled, and a cross-peer mutex needs the (deferred) session-message channel ([[epic-session-liveness-fixes]] §WB5). `playlist.coHostIds` stays in schema v5, unused, to avoid a migration
- ⚠️ 682 app + 16 relay + 99 service passing tests (P2P protocols, replication, LWW, file transfer, companion, downloader backends; db-service and P2P turn suites landed 2026-08-06 — #26/#32 closed) — but `p2p-service.ts` and nearly all renderer components remain untested, and there are still no React error boundaries (#49)
- 🔜 Open metadata enrichment (MusicBrainz/ListenBrainz)
- 📋 Local file import adapter — absorbed into [[audio-acquisition-service]] (Phase A shipped)

**Next focus**: the v0.1.0 pre-merge touch-up workstreams have landed on `mvp` (2026-08-05/06): format standardization, test reorg + gap fill (#26/#32 closed), organizational pass, tech-debt inventory ([[report-260806-tech-debt-inventory]], issues #67–#79 filed), merge-gate fixes (#70/#71/#72 closed), and this docs consolidation. Remaining before the `mvp`→`main` PR: human live QA (handshake #58, companion lockstep deploy, backend-path dialog). Backlog reconciliation: [[report-260627-issue-reconciliation]].

> **Roadmap amendment (user ruling 2026-08-03)** — the **P2P social layer (turn-taking, presence, queue) and the session-message channel it needs are post-MVP**, re-sequencing `CLAUDE.md` §Development Roadmap Phase 1's "Social layer" line. The social layer serves the moment WhatNext decouples from Spotify; that moment needs *proven* P2P playlist and library sharing first. Reactions and comments are unaffected — they ride RxDB replication and stay in Phase 1. Rationale: [[epic-session-liveness-fixes]] §WB5.

---

## Recent Architecture Decisions

- [[adr-260315-companion-client-architecture]] — Phone companion: Electron-served HTTP + WebSocket for zero-install mobile session participation (2026-03-15)
- [[adr-260315-p2p-session-pairing]] — Remote pairing: circuit relay + DCUtR, user-configured relay, invite URL, playback mutex (2026-03-15)
- [[adr-260307-session-architecture-provider-abstraction]] — Sessions are platform-agnostic; TrackSource/PlaybackProvider abstraction (2026-03-07)

---

__Last Updated__: 2026-08-06
__Documentation Version__: v0.8.0 (docs consolidation pass: epic statuses reconciled with shipped PRs, Nov-2025 notes archived into concept pages, [[milestone-v0.0.0]] created, four-process model corrected vault-wide, `useCompanionBridge` deletion recorded)


