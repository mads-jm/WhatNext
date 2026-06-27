---
tags:
  - report
  - architecture/review
  - mvp
status: active
date created: 2026-06-27
date modified: 2026-06-27
---

# MVP State of the Union — 2026-06-27

#report #architecture/review #mvp

> **Purpose**: A ground-truth vetting of WhatNext after a stale period. Reconciles the optimistic "✅ done" status in [[index]] against actual code reality across the three MVP pillars — **playback, sessions, sourcing** — and confirms the Spotify API strategy. Companion document: [[report-260627-issue-reconciliation]].

## Executive Summary

The project is **further along than the GitHub board says and shakier than the docs say.** Every foundational feature exists and the architecture is sound, but the three integration pillars are **happy-path-only and almost entirely untested**. The newest layer (sourcing) is paradoxically the most mature because it shipped with infra-level tests; the oldest "done" layer (P2P sessions/replication) is the most fragile and has **zero test coverage**.

The Spotify Feb-2026 lockdown is **permanent and validates the decoupling thesis** — no strategy change needed. The remaining MVP work is a "long last mile" of **un-stubbing functional gaps, hardening fragile integrations, and standing up tests** — not new feature invention.

**Maturity at a glance:**

| Pillar | Feature-complete? | Reliable? | Tested? | Verdict |
|--------|:---:|:---:|:---:|---------|
| **Sourcing** (local + download) | ⚠️ mostly | ✅ mostly | ⚠️ infra only | Most mature; backends untested end-to-end |
| **Playback** (Spotify Connect) | ✅ | ⚠️ naive errors | ❌ | Works for Premium demo; no coordination layer |
| **Sessions** (P2P/replication) | ⚠️ stubs remain | ❌ fragile | ❌ | Architecturally sound, operationally brittle |

---

## 1. Spotify API — Lockdown is Permanent; Thesis Validated

The February 2026 Developer Mode restrictions are real, in force, and **not being reversed**. Confirmed against Spotify's own documentation and press as of June 2026:

- **Premium required** for Dev Mode API access (since 2026-03-09); **5 test users** max (down from 25); **one Client ID per developer**.
- **Extended Quota** now requires a registered business with **250,000 MAU** — effectively unreachable for an indie/sovereign app.
- The gutted endpoints — **audio-features, audio-analysis, recommendations, artist top-tracks, new-releases, bulk track metadata, other-user profiles, artist followers/popularity, album labels, markets-for-tracks** — remain **dead for new/dev-mode apps with no replacement** ~18 months after the Nov-2024 announcement.

**Implication for WhatNext:** the current Spotify adapter already uses **only allowed endpoints** — playlist-read, playback-control (Premium-gated), own-profile. It depends on **none** of the gutted endpoints. The [[the-walled-garden-cracks]] coordinator model isn't merely defensible; it is the only viable path. **No reason to shift away from provider decoupling — this confirms it.**

**Sources:**
- [Feb 2026 migration guide](https://developer.spotify.com/documentation/web-api/tutorials/february-2026-migration-guide)
- [Spotify dev blog: Update on Developer Access](https://developer.spotify.com/blog/2026-02-06-update-on-developer-access-and-platform-security)
- [March 2026 changelog](https://developer.spotify.com/documentation/web-api/references/changes/march-2026)
- [TechCrunch coverage](https://techcrunch.com/2026/02/06/spotify-changes-developer-mode-api-to-require-premium-accounts-limits-test-users/)

---

## 2. PLAYBACK — Works for the Demo, No Coordination Layer

**Implemented & solid** (`app/src/main/spotify/`):
- OAuth PKCE (32-byte verifier, SHA256 challenge), custom protocol callback, encrypted token storage via `safeStorage`, proactive refresh at 5-min buffer — `spotify-auth.ts`, `token-store.ts`.
- Full Spotify Connect control: play/pause/next/previous/seek/devices (7 endpoints), correct `204 No Content` handling via `spotifyFetchRaw()` — `spotify-client.ts:183–292`.
- Playlist import with pagination, snapshot-id short-circuit, and `added_by` attribution.

**Shaky / missing:**
- **No HTTP status discrimination.** All non-200s throw a generic `Spotify API error {status}` — `spotify-client.ts:76–77,176–177`. No **403/Premium** detection, no **429/rate-limit** handling, **no retry/backoff**, no request timeouts.
- **Token can expire mid-flow** — acknowledged `TODO` at `app/src/main/main.ts:498` ("need a UX pass on token expiry… proactively refresh and/or prompt").
- **Playback mutex is unimplemented.** `coHostIds` / `playbackOwnerId` exist only as schema fields (`app/src/shared/session-interfaces.ts:51–52`). Nothing enforces single-controller; Spotify is polled independently per peer (`usePlaybackState.ts`), so concurrent control is first-writer-wins with no coordination.
- **Companion playback control is stubbed** — phone receives snapshots but cannot control back (see §4).

**Tests:** mapper + IPC-handler logic tested (`app/src/main/__tests__/ipc.test.ts`); **OAuth flow, token refresh, and all playback control are untested**.

---

## 3. SESSIONS — Architecturally Sound, Operationally Fragile

> ⚠️ The P2P protocol is off-limits for autonomous agentic work per [[CLAUDE]] policy — all changes here require explicit human approval.

**Implemented & working:** clean utility↔main↔renderer process model, mDNS discovery, circuit-relay + DCUtR remote pairing, length-framed handshake, turn-taking UI, reactions/comments, companion HTTP+WebSocket server. Architecture per [[adr-260307-session-architecture-provider-abstraction]] and [[adr-260315-p2p-session-pairing]] is genuinely good.

**Fragile / stubbed — the operational risk lives here:**
- **Checkpoints are in-memory only** (`app/src/utility/p2p-service.ts:71`) → **full resync of all collections on every app launch**.
- **5-second pull timeout resolves empty silently** (`p2p-service.ts:553–556`) → **slow/loaded peers silently drop remote changes**.
- **LWW uses string comparison, not timestamp parsing** (`app/src/renderer/db/replication-handler.ts:60`) → works for ISO-8601 by coincidence; brittle to any format drift or clock skew.
- **Thin reconnection.** Relay disconnect reschedules a retry to the *same* relay (`relay-manager.ts:103`) but with **no exponential backoff, no alternate-relay fallback, and no liveness/heartbeat** (fixed 10s interval, max 5 retries).
- **Turn-advance race** on concurrent adds — `advanceTurn()` can fire twice; UI distrusts stored `currentTurnUserId` and re-derives from track history (`TurnManagementPanel.tsx:127`).
- **Manual & P2P track sources are stubbed** (`app/src/renderer/hooks/useTrackSource.ts:322` returns a no-op for `'manual'` and `'p2p'`).
- **Companion is snapshot-only** — bidirectional control wired in protocol but not in app logic (§4).
- **File-transfer backpressure unhandled** for files >10MB (`app/src/utility/protocols/file-transfer.ts:463–466`).

**Tests:** **zero** for p2p-service, replication, handshake, relay-manager, turn coordination. This is the highest-risk gap in the codebase — regressions here are invisible.

---

## 4. SOURCING — Newest Work, Most Mature of the Three

**Implemented & tested (infra level):**
- **Local import** — recursive scanner, 10 audio formats, `music-metadata` extraction with filename-parser fallback (`app/src/main/media/`); filename parser has unit tests.
- **yt-dlp backend** (`service/downloader/backends/ytdlp-backend.ts`) — progress/speed/ETA parsing, destination capture; **spotDL backend** with graceful JSON-fallback and cache-skip detection.
- Robust **subprocess lifecycle** — process-tree kill (`taskkill /T /F` on Windows, SIGTERM→SIGKILL on POSIX), inactivity timeout, kill-all on `will-quit` (`service/downloader/subprocess.ts`; `main.ts:679–690`).
- **Purchase-link attribution** (MusicBrainz → Bandcamp scrape fallback, rate-limited, disk-cached) and a tested **dedup AudioStore**.
- **Track schema v1→v3 migration** (`app/src/renderer/db/schemas.ts:152–246`) — all new audio fields optional, **backward-compatible, safe**.

**Shaky / PoC:**
- **Spytify is Windows-only, real-time-only PoC**, platform-gated.
- **P2P fileshare is v0** (commit `7fd84d1`, ~4590 lines, **untested**).
- **External binaries assumed-in-PATH** — no bundling, no custom-path config yet (acknowledged in `DownloadSettings`).
- **No backend-execution integration tests** — only parsers/mappers are tested; the actual yt-dlp/spotDL/Spytify CLI invocation is not.

---

## 5. Documentation Accuracy Gaps

The vault is comprehensive but its **status claims run ahead of code reality**. Corrections needed (tracked, not yet applied beyond [[index]]):

- **[[index]] "Active Development Status"** marked replication, sessions v1, co-host/mutex, and companion as plain ✅. Reality: feature-present but fragile/partially-stubbed. → **Updated by this pass** to reflect honest state.
- **Sessions / RxDB-Replication concept pages** describe checkpoint sync, LWW, and the mutex as complete. They should note: in-memory checkpoints, string-LWW, unimplemented mutex. → *Pending.*
- **[[Companion-Client]]** should note bidirectional control is stubbed (snapshot-only today). → *Pending.*
- Pre-existing candid audits remain accurate and worth re-reading: [[mvp-reality-react-quality]] (zero component tests, no error boundaries, god-orchestrator `SessionView`) and [[dead-code-audit-260322]].
- **Vault hygiene:** `06 reports/` was empty (now seeded); `09 PRs/` and `09 milestones/` are empty while `10 PRs/` holds the PR index — folder numbering is duplicated and should be consolidated. → *Pending.*

---

## 6. The Last Mile — What "Done" Actually Requires

Ordered to match the chosen near-term focus (**finish stubbed features first**, then harden, then test). Full per-item dispositions and draftable GitHub issues live in [[report-260627-issue-reconciliation]]. The work is grouped into six domain **epic specs** (`08 specs/`): [[epic-replication-reliability]] (foundation), [[epic-session-coordination]], [[epic-track-sourcing]], [[epic-spotify-resilience]], [[epic-audio-acquisition-hardening]], [[epic-app-reliability-quality]].

**A. Finish stubbed features (functional gaps):**
1. Playback mutex — enforce `playbackOwnerId`, handoff state machine + UI.
2. Un-stub Manual track source (`useTrackSource.ts:322`).
3. Un-stub P2P track source.
4. Companion bidirectional control (control-back from phone).

**B. Reliability hardening:**
5. Persist replication checkpoints (kill the per-launch full resync).
6. Replication timeout/backoff + reconnection (kill the silent drop).
7. LWW timestamp parsing (replace string compare).
8. Turn-advance coordination (kill the race).
9. Spotify error handling — 403 Premium / 429 rate-limit / retry / token-expiry UX.

**C. Tests (currently near-zero where it matters):**
10. Backend-execution integration tests (yt-dlp/spotDL/Spytify).
11. P2P/replication/handshake/turn tests.
12. Spotify OAuth + playback integration tests.
13. Critical-flow E2E (import, session lifecycle, turn cycle).

**D. Quality (from [[mvp-reality-react-quality]]):** React error boundaries, extract `useSessionData` to thin `SessionView`, `<ArtworkImage>` de-duplication, visibility-based polling.

---

## Related

- [[index]] — documentation map (status section updated by this pass)
- [[report-260627-issue-reconciliation]] — per-issue dispositions + draftable issues
- [[the-walled-garden-cracks]] — Spotify strategy / coordinator model
- [[mvp-reality-react-quality]] · [[dead-code-audit-260322]] — prior audits
- [[adr-260307-session-architecture-provider-abstraction]] · [[adr-260315-p2p-session-pairing]] · [[adr-260315-companion-client-architecture]]
