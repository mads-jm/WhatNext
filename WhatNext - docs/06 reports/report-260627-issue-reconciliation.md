---
tags:
  - report
  - process/backlog
  - mvp
status: active
date created: 2026-06-27
date modified: 2026-06-27
---

# GitHub Issue Reconciliation — 2026-06-27

#report #process/backlog #mvp

> **Purpose**: The GitHub board ([WhatNext MVP - Electron Client POC](https://github.com/users/mads-jm/projects/2)) is stale — **all 25 open issues date from Jul–Aug 2025** and describe foundational work that is now largely shipped. This is the **plan-only** reconciliation (no GitHub writes performed yet, per direction). Companion to [[report-260627-mvp-state-of-the-union]]. Evidence cited at `file:line`.

## How to read this

- **CLOSE** — work is done; close with a "done as of `<commit/file>`" comment.
- **REFRAME** — partially done or scope-changed; edit title/body to reflect reality.
- **WONT-FIX** — superseded by a different decision; close with rationale + ADR link.
- **KEEP** — genuinely still open; reframe with current file paths.

---

## A. Existing issues — proposed disposition

| # | Title | Disposition | Evidence / rationale |
|---|-------|-------------|----------------------|
| 1 | Initialize Electron Main & Renderer | **CLOSE** | App runs; `app/src/main/main.ts`, renderer present |
| 2 | Basic UI Shell (React + TS) | **CLOSE** | ~45 components; [[mvp-reality-react-quality]] |
| 3 | Setup Electron IPC for Core | **CLOSE** | `app/src/shared/core/ipc-protocol.ts`, preload bridge |
| 4 | Spike: Evaluate RxDB | **CLOSE** | RxDB adopted and in production use |
| 5 | Integrate RxDB + Core Schemas | **CLOSE** | `app/src/renderer/db/schemas.ts` (now at v3) |
| 6 | Local Playlist & Track CRUD | **CLOSE** | `playlist-service.ts`, `track-service.ts` |
| 10 | Handle `whtnxt://connect` Protocol | **CLOSE** | Registered + parsed `main.ts:443–577,1383`. Full-link join works; **short-code join explicitly deferred to Phase 2** (`main.ts:1394`) — note this in the close comment |
| 12 | Spotify OAuth 2.0 (PKCE) | **CLOSE** | `spotify-auth.ts` — complete PKCE + refresh |
| 13 | Fetch & Display Spotify Playlists | **CLOSE** | `useSpotifyImport.ts`, pagination in client |
| 14 | Spotify Read-Only Sync (Polling) | **CLOSE** | `useSpotifySync.ts`, snapshot-id short-circuit |
| 15 | Integrate Spotify Playback Controls | **CLOSE** → spawns **N9** | Done `spotify-client.ts:183–292`; hardening (403/429/retry) tracked as new issue |
| 16 | Session Management UI | **CLOSE** | `components/Session/SessionView.tsx` et al. |
| 17 | Display Connected Peers in UI | **CLOSE** | `P2PStatus.tsx`, `useP2PStatus.ts` |
| 18 | Shared Queue / Turn-Taking UI | **CLOSE** → spawns **N8** | UI done `TurnManagementPanel.tsx`; race tracked separately |
| 19 | Indicate "Accessory Mode" in UI | **CLOSE** (verify) | `accessory` surfaced in `SpotifyImportComplete.tsx`, schemas, hooks — verify the badge renders in-session |
| 20 | Setup CI/CD Pipeline | **CLOSE** | `.github/workflows/`: ci, p2p-gate, release, schema-guard, persist-pr |
| 21 | Setup Unit Test Framework (Vitest) | **CLOSE** | Vitest live; multiple `__tests__` suites pass |
| 22 | Configure electron-builder Packaging | **REFRAME** | `package` script + `build` block in `app/package.json` exist; **distributable never verified end-to-end** — narrow issue to "produce + smoke-test installers per platform" |
| 26 | Unit Tests: Playlist & Track CRUD | **KEEP** | No service-layer tests exist |
| 27 | Spike: Libp2p PoC in Electron | **CLOSE** | Superseded by full integration; [[note-251110-libp2p-first-implementation-learnings]] |
| 28 | Integrate Libp2p into Electron Client | **CLOSE** | `app/src/utility/p2p-service.ts` |
| 29 | Peer Discovery via Kademlia DHT | **WONT-FIX** | No DHT in code; chose **mDNS + circuit relay** instead — [[adr-260315-p2p-session-pairing]]. Close with rationale |
| 30 | NAT Traversal (Hole Punch + Relay) | **CLOSE** | Circuit relay + DCUtR in `relay/`, `p2p-service.ts:429` |
| 31 | RxDB Replication over Libp2p | **CLOSE** → spawns **N5–N7** | Implemented `protocols/replication.ts`; fragility tracked as hardening issues |
| 32 | Unit Tests: P2P Connection Logic | **KEEP** | Zero P2P tests — high priority |
| 33 | Integration Tests: Spotify API | **KEEP** | OAuth/playback untested |

**Summary:** ~18 CLOSE · 1 WONT-FIX · 1 REFRAME · 3 KEEP (tests). Three "CLOSE" issues spawn the hardening issues below.

---

## B. Drafted new issues — the real "last mile"

Ordered to match near-term focus: **finish stubbed features → harden → test → quality.** Not yet created on GitHub.

### Functional gaps (stubbed) — _priority_

- **N1 · Implement playback mutex** `feat(sessions)` — enforce `playbackOwnerId`; handoff state machine + grant/revoke UI. Fields exist unused at `session-interfaces.ts:51–52`. ⚠️ touches P2P — needs human approval.
- **N2 · Un-stub Manual track source** `feat(sessions)` — `useTrackSource.ts:322` returns no-op for `'manual'`.
- **N3 · Un-stub P2P track source** `feat(p2p)` — same no-op path for `'p2p'`; depends on replication being trustworthy (N5–N7). ⚠️ P2P.
- **N4 · Companion bidirectional control** `feat(sessions)` — phone→host control-back (reactions/queue/play); protocol exists, app logic stubbed. [[Companion-Client]].

### Reliability hardening

- **N5 · Persist replication checkpoints** `fix(p2p)` — in-memory at `p2p-service.ts:71` → full resync each launch. ⚠️ P2P.
- **N6 · Replication timeout/backoff + reconnection** `fix(p2p)` — 5s silent-empty at `p2p-service.ts:553–556`; no relay fallback `relay-manager.ts:95–104`. ⚠️ P2P.
- **N7 · LWW timestamp parsing** `fix(p2p)` — string compare at `replication-handler.ts:60` → parse to epoch. ⚠️ P2P.
- **N8 · Turn-advance coordination** `fix(sessions)` — double-advance race; UI re-derives from history `TurnManagementPanel.tsx:127`.
- **N9 · Spotify error handling** `fix(spotify)` — 403 Premium detection, 429 rate-limit + retry/backoff, request timeouts, token-expiry UX (`main.ts:498`).

### Sourcing

- **N10 · Backend-execution integration tests** `test(downloader)` — yt-dlp/spotDL/Spytify CLI invocation untested (only parsers/mappers covered).
- **N11 · Binary bundling / custom-path config** `feat(downloader)` — binaries assumed-in-PATH; add path config + presence checks.
- **N12 · Harden + test P2P fileshare v0** `fix(p2p)` — ~4590 LOC untested; backpressure unhandled `file-transfer.ts:463–466`. ⚠️ P2P.

### Tests & quality

- **N13 · P2P/replication/handshake/turn tests** `test(p2p)` — satisfies #32; covers N5–N8 regressions. ⚠️ P2P.
- **N14 · Spotify OAuth + playback integration tests** `test(spotify)` — satisfies #33.
- **N15 · Service-layer CRUD tests** `test(db)` — satisfies #26.
- **N16 · Critical-flow E2E** `test` — import, session lifecycle, turn cycle (Playwright). Flows enumerated in [[mvp-reality-react-quality]].
- **N17 · React error boundaries** `fix(ui)` — none today; one unhandled RxDB/Spotify error crashes the app.
- **N18 · Extract `useSessionData`, thin `SessionView`** `refactor(ui)` — god-orchestrator; [[mvp-reality-react-quality]].

---

## C. Execution plan (when approved)

1. Bulk-close the 18 done issues with evidence comments; WONT-FIX #29 (link ADR); reframe #22.
2. Keep + retitle #26/#32/#33 with current paths (become N15/N13/N14).
3. Open N1–N18 with labels above; **P2P-touching items (N1,N3,N5,N6,N7,N12,N13) flagged for human approval** per [[CLAUDE]] agentic policy.
4. Seed `00 index/BACKLOG.kanban.md` to mirror the GitHub state inside Obsidian.
5. Reconcile the GitHub Project board columns to match.

## D. Execution log — completed 2026-06-27

Full reconcile executed against `mads-jm/WhatNext`:

- **Closed 21 shipped issues** (#1–6, 10, 12–21, 27, 28, 30, 31) with evidence comments.
- **#29 → WONT-FIX** (mDNS+relay chosen over DHT).
- **Reframed in place (kept open):** #22 (packaging→smoke-test), #26 (CRUD tests), #32 (P2P tests), #33 (Spotify integration tests).
- **Opened 15 new issues** (#36–#50). Created labels `sessions`, `downloader`; P2P items tagged `needs-p2p-review`.

**N-item → GitHub issue map:**

| N | Issue | N | Issue | N | Issue |
|---|---|---|---|---|---|
| N1 | #36 | N7 | #42 | N13 | #32 |
| N2 | #37 | N8 | #43 | N14 | #33 |
| N3 | #38 | N9 | #44 | N15 | #26 |
| N4 | #39 | N10 | #45 | N16 | #48 |
| N5 | #40 | N11 | #46 | N17 | #49 |
| N6 | #41 | N12 | #47 | N18 | #50 |

In-vault board mirror: [[BACKLOG.kanban]]. **Next build target** (per chosen focus): #37 → #36, with #38 gated on replication hardening (#40–#42). ⚠️ #36/#38 touch P2P — need human approval before agentic work.

## E. Epic specs (08 specs/)

The 19 open issues are grouped into six forward-looking domain epics. Each verifies its own file:line evidence and carries acceptance criteria.

| Epic | Issues | Notes |
|------|--------|-------|
| [[epic-replication-reliability]] | #40, #41, #42, #47, #32 | Foundation — other P2P work depends on it ⚠️ |
| [[epic-session-coordination]] | #36, #43, #39 | Mutex ⚠️, turn coordination, companion control |
| [[epic-track-sourcing]] | #37, #38 | #37 = recommended first build (no P2P approval); #38 gated on replication ⚠️ |
| [[epic-spotify-resilience]] | #44, #33 | Error taxonomy, retry/backoff, token UX, tests |
| [[epic-audio-acquisition-hardening]] | #45, #46 | Backend exec tests, binary bundling/path config |
| [[epic-app-reliability-quality]] | #49, #50, #48, #26, #22 | Error boundaries, refactor, E2E, CRUD tests, packaging |

**Corrections folded back from spec drafting** (issues updated on GitHub): #48 — Playwright is already scaffolded (empty tests), not absent; #22 — only a `win portable` target exists + companion-web won't resolve in a packaged build; #45 — spotDL `'spotify-id'` vs `'spotify-ids'` capability mismatch.
