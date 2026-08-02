---
tags:
  - specs/sessions
  - specs/downloader
  - architecture/companion
status: draft
date created: 2026-08-01
date modified: 2026-08-01
---

# Epic: Session & Downloader Liveness Fixes

**Status**: Draft
**GitHub**: #56, #57 (downloader); companion/playback items to be filed (plan-first)
**Depends on**: none for code; coordinate with [[epic-ipc-trust-boundary]] on `downloader-ipc.ts` (that lane owns handler-entry validation; this lane owns event/import flow)
**Source audit**: live QA 2026-08-01 (#56, #57); [[report-260801-mvp-premerge-review]] §2

> The grab-bag lane: the two downloader defects found in live QA plus the review's §2 session-layer debt — a sync loop that deadlocks after unmount, a companion server with no authentication, relay phones whose acks vanish, and a playback "mutex" whose UI promises mutual exclusion that nothing enforces. Individually small; together they're the difference between features that demo and features that survive a real session.

## Problem & Current State

1. **#56 — spotDL metadata fallback is lossy** — the spotDL `save` JSON parse falls back to a stub track (title = URL, no album/duration) instead of surfacing the parse failure. Users get junk library entries that look like successful imports.
2. **#57 — a completed download can be silently dropped from import** — *(corrected 2026-08-01: the original entry described the `WHATNEXT_FILEPATH` sentinel as an `--exec` postprocessor. It is not — `ytdlp-backend.ts:118` passes `--print after_move:WHATNEXT_FILEPATH=%(filepath)s`, a print template, and that part is already implemented.)* The real defect is in the renderer: `usePlaylistDownload.ts` sets the row to `status: 'complete'` and transitions the flow to `done` for **every** `complete` event, but `importCompleted` only imports tracks present in `completedPaths` — so a `complete` event carrying no `localFilePath` is counted as a success and then dropped from the library import. Post-processing failure is one route into that state, not the only one (a non-zero yt-dlp exit already routes to an `error` event), and `spotdl-backend.ts:137-147` can emit the same pathless `complete`.
3. **Sync-loop deadlock** — `app/src/renderer/hooks/useTrackSource.ts:298-303`: `syncingRef.current = false` only runs in `finally` when `!cancelled`. Unmount/`enabled`-toggle mid-poll leaves the ref (which survives effect re-runs) stuck `true`; every future poll returns at the `:190` guard. The Spotify arm silently never syncs again until full remount.
4. **[[Companion-Client|Companion server]]: no auth, host by display name** — `app/src/main/companion/companion-server.ts:325,177-179`: binds `0.0.0.0`, no join token; `isHost` granted by case-insensitive *display-name* match — host impersonation is typing the host's name. Relay tunnel compounds it: `relay/companion-tunnel.mjs:227-232` lets any WS to `/host/<code>` *replace* the host, and the code is printed in the public phone URL (`/s/<code>`).
5. **Relay phones never get time-request acks** — `companion-server.ts:431-436` vs `:565-616`: relay joins register callback ids (`relay-${displayName}`/`'relay-phone'`) but `sendTimeRequestAck(clientId)` looks up the local-LAN `clients` map — acks to tunneled phones silently vanish.
6. **Playback "mutex" is local-only** — `app/src/renderer/stores/navigation-store.ts:93-102` + `app/src/shared/session-interfaces.ts:52`: `playbackOwnerId` drives real UI (`App.tsx:24`, `SessionView.tsx:178,271`) but no protocol message propagates ownership; each peer seeds its own `sessionState`, so two peers can both render "you own playback" and both drive Spotify Connect.
7. **(cheap, adjacent)** — companion "reconnect" adopts any same-display-name client whose socket isn't OPEN (`companion-server.ts:151-167`) → identity merging; and the 2s Spotify poll (`useTrackSource.ts:27`, 30 req/min) should widen to 10–15s now that 429s back off properly.

## Goals

- Downloader outcomes are truthful: parse failures surface as failures (#56); a completed download always imports or visibly errors (#57).
- The Spotify sync loop survives unmount/remount cycles indefinitely.
- Companion sessions require a credential: host secret for host attach (LAN + relay), short join PIN in the QR payload for participants.
- Relay-tunneled phones receive time-request acks.
- Playback-ownership UI is honest: MVP = replicate ownership as a session message **or** relabel the control host-local — decide via the open question below; either way the two-owners state must be impossible *or* impossible-looking-states removed.

## Non-Goals

- Downloader argv/URL validation and `set-backend-path` gating — [[epic-ipc-trust-boundary]].
- New companion features (capabilities stay reactions/time-requests).
- CRDT or turn-protocol work; P2P handshake — [[epic-handshake-stabilization]].
- Spytify backend changes (Windows-only PoC).

## Proposed Approach

1. **#56**: treat spotDL save-JSON parse failure as a failed resolve — typed error to the UI, no stub-track write; keep any raw output attached to the error for debugging.
2. **#57**: *(approach settled 2026-08-01 — **no filesystem fallback**.)* A `complete` event with no `localFilePath` gets its own terminal progress status (`unimported`) instead of `complete`, rendered as "downloaded, not imported" in the progress rows and counted separately in the completion summary. Deterministic path reporting is already in place (`--print after_move:…`); adding glob/heuristic resolution on top would guess at which file belongs to which track. Removing the false success is the fix — the user can retry the download.
3. **Sync deadlock**: reset `syncingRef.current` unconditionally in `finally`; widen poll interval to 10–15s while in the file (one-line each).
4. **Companion auth**: issue a host secret at `POST /session`; require it on host attach locally and on relay `/host/<code>`; add a short numeric join PIN to the QR payload and check it on join; per-client reconnect token replaces the display-name adoption at `:151-167`.
5. **Relay acks**: register relay phones as tracked clients (or route acks through `sendToRelay`) so `sendTimeRequestAck` reaches them.
6. **Playback ownership**: decide the open question first (see Risks); if replicating, add a minimal `playback-ownership` session message (claim/release, host-arbitrated, LWW on conflict) — note this touches `app/src/shared/core/protocol.ts`; if deferring, gate the take/hand-off controls to the host and label them.

## Work Breakdown

### 1 — #56 spotDL parse fallback

- [x] A malformed/empty spotDL `save` JSON produces a user-visible resolve failure; no track with title==URL is ever written (regression test with captured bad output).
- [x] Well-formed output unchanged (existing fixtures green).

### 2 — #57 truthful completion state

- [x] A `complete` event with no `localFilePath` ends in an explicit "downloaded, not imported" state — never a silent success-without-import. Holds for both backends (the state lives in the renderer).
- [x] Path-present flow unchanged (import and "complete" row identical to before).

### 3 — Sync loop + poll interval

- [x] A poll interrupted mid-flight no longer wedges the loop; syncing resumes. *(Note: `syncingRef` is per component instance, so a true unmount → remount always got a fresh ref. The observable wedge is effect teardown without unmount — `enabled` toggle, playlist change, or StrictMode's double-invoked effect — which is what the test drives.)*
- [x] Poll interval ≥ 10s (now 12 s); snapshot short-circuit still avoids redundant work.

### 4 — Companion auth + relay acks

- [ ] Host attach without the secret is rejected (LAN and relay paths, tests); phone join without the PIN is rejected.
- [ ] The QR/URL payload carries the PIN; the printed session code alone no longer grants host takeover on the relay.
- [ ] A relay-tunneled phone's time request receives an ack (harness or manual QA evidence).
- [ ] Same-name second guest gets a distinct identity (reconnect token, not name adoption).

### 5 — Honest playback ownership

- [ ] Decision recorded (replicate vs relabel) with rationale in this spec's revision.
- [ ] Two connected peers can no longer both display an active "you own playback" control (test or scripted QA for the chosen design).

## Epic Acceptance Criteria (Definition of Done)

- [ ] #56, #57 closed; review §2 items (deadlock, companion auth, relay acks, playback mutex, poll cadence, name adoption) closed or explicitly re-ticketed with rationale.
- [ ] All fixes covered by tests where the harness allows; live QA pass for companion (LAN + relay) and a 2-peer playback-ownership check.
- [ ] `npm test` green; no new lint/typecheck failures; concept docs updated where behavior changed (companion auth flow, playback ownership contract).

## Risks & Open Questions

- **Playback ownership scope**: replicating ownership adds a message to `shared/core/protocol.ts` (session protocol surface — small but real; the honest-relabel option is zero-protocol and fine for MVP). Governor should put this choice to the user before the architect commits.
- **Companion auth vs zero-friction join**: the PIN adds one step to the phone-join flow the product deliberately keeps frictionless — keep it short (4 digits, embedded in the QR so scanning stays one-step; typing only for manual URL entry).
- ~~**#57 fallback resolution**~~ — **resolved 2026-08-01**: no filesystem fallback at all. Deterministic `--print after_move:` reporting is already in place; when it yields nothing the track is marked "downloaded, not imported" rather than guessed at.
- **File overlap**: `useTrackSource.ts` is touched here only (trust-boundary lane doesn't enter renderer hooks) — but confirm at dispatch; `downloader-ipc.ts` is shared with [[epic-ipc-trust-boundary]] (disjoint hunks: validation-at-entry vs event flow).

## References

- Issues #56, #57; [[report-260801-mvp-premerge-review]] §2, §3
- Code: `app/src/renderer/hooks/useTrackSource.ts:27,190,298-303`; `app/src/renderer/hooks/usePlaylistDownload.ts:161`; `app/src/main/companion/companion-server.ts:151-167,177-179,325,431-436,565-616`; `relay/companion-tunnel.mjs:227-232`; `app/src/renderer/stores/navigation-store.ts:93-102`; `app/src/shared/session-interfaces.ts:52`; `service/downloader/` (spotDL/yt-dlp backends)
- Related: [[epic-audio-acquisition-hardening]] (landed), [[companion-client-spec]], [[epic-session-coordination]]
- Concepts: [[Companion-Client]], [[Sessions]], [[Spotify-Integration]]
