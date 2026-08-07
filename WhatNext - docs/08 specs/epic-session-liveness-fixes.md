---
tags:
  - specs/sessions
  - specs/downloader
  - architecture/companion
status: complete — live QA pending
date created: 2026-08-01
date modified: 2026-08-06
---

# Epic: Session & Downloader Liveness Fixes

**Status**: Complete — all cycles (1, 2, 2b, 3) landed on `mvp`; only the human live-QA passes remain (see DoD)
**GitHub**: #56, #57 (downloader; fixed); follow-ups re-ticketed as #59, #60
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
6. **Playback ownership**: decide the open question first (see Risks); if replicating, add a minimal `playback-ownership` session message (claim/release, host-arbitrated, LWW on conflict) — note this touches `app/src/shared/core/protocol.ts`; if deferring, gate the take/hand-off controls to the host and label them. *(Superseded 2026-08-03 — neither: the controls were dead UI and were removed outright. See WB5.)*

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

*Split across two cycles by user ruling 2026-08-02: cycle 2 landed the host half (`42f8ff4`), cycle 2b the participant half.*

- [x] Host attach without the secret is rejected (LAN and relay paths, tests); phone join without the PIN is rejected. *(Host: cycle 2. Join PIN: cycle 2b — validated host-side on both transports, so the relay stays a dumb pipe and needs no lockstep wire-contract deploy.)*
- [x] The QR/URL payload carries the PIN; the printed session code alone no longer grants host takeover on the relay. *(The PIN rides in the URL **fragment** — never sent to a server, so it stays out of relay access logs while a scanned QR is still one step.)*
- [x] A relay-tunneled phone's time request receives an ack (harness or manual QA evidence). *(Cycle 2, covered by `companion-server.test.ts`.)*
- [x] Same-name second guest gets a distinct identity (reconnect token, not name adoption).
- [x] **Amendment (user ruling 2026-08-02)**: the PIN is **4 alphanumeric characters** over the existing ambiguity-free 32-symbol alphabet (`ABCDEFGHJKLMNPQRSTUVWXYZ23456789`), not the 4 digits in Risks below — 32⁴ ≈ 1.05M vs 10⁴, same generator shape, same one-step scan.
- [x] Host-side join-attempt lockout: 10 failed PINs freeze *new* joins for 60s (session-level state, no wire change). A phone presenting a valid reconnect token is exempt — it already cleared the PIN gate this session, and without the exemption one guest's typos eject every other phone at its next ordinary reconnect.
- [x] A refused join is visibly explained on the phone (`join:denied` + no-answer timeout), instead of hanging on an empty session screen.
- [x] The display-name host claim is removed on **both** paths; no phone is host in Phase 1. The phone's HOST badge and host-mode behaviour go with it.
- [x] Phone-UI changes landed in both `companion-web` copies, guarded by a checksum-diff test (`relay/__tests__/companion-web-parity.test.mjs`).
- [ ] Live QA against a real phone browser and a separate relay process: scan-join, wrong-PIN + lockout, reconnect, same-name second guest, **and the combination — a joined phone's socket bouncing while another guest's lockout is active (it must stay in the session)**. *(Human pass — automated tests cannot cover a QR scan or a mobile browser.)*

**Re-ticketed out of WB4**: unifying the two `companion-web` copies; a credentialed host-phone claim (only if the HOST badge is missed); the terminal-tunnel-failure UI in `CompanionSharePanel` (folds into WB5); the post-upgrade rejection race when the *host's own* token is wrong (host-side, not participant-side).

### 5 — Honest playback ownership

- [x] Decision recorded (replicate vs relabel) with rationale in this spec's revision. **Decision: remove, not relabel** — see below.
- [x] Two connected peers can no longer both display an active "you own playback" control (test or scripted QA for the chosen design). *No peer displays one at all; pinned by `playback-helpers.test.ts` + `navigation-store.test.ts` and the two-peer QA script below.*

#### Decision (2026-08-03): remove the ownership surface, do not replicate it

The open question above offered *replicate* or *relabel*. Reading the code first
made a third option the only honest one — **remove** — because two premises in
the problem statement were wrong:

1. **There is no session-message transport to add a message to.** `shared/core/protocol.ts` is the `whtnxt://` URL parser, not a session protocol; the libp2p protocol set is handshake / rxdb-replication / ping / file-transfer. "Replicate ownership" means *building a channel*, not extending one.
2. **"Two peers can both render 'you own playback'" understates it — that was the only reachable state.** `sessionState` was only ever created by `SessionSetup.handleStart`, which always set `hostId = own user.id`, and `startSession` seeded `playbackOwnerId = config.hostId`. So `isPlaybackOwner` was `true` on every peer, always: the "Playback owned by …" branch, the Take Playback button (needs `!isPlaybackOwner`) and the hand-off `<select>` (needs a non-empty `coHostIds`, which nothing ever wrote) were **dead UI**. Relabelling dead controls would have preserved a promise with no mechanism behind it.

A cross-peer owner needs, before any message type: an agreed session identity, an
agreed participant set, and a stable cross-peer user identity. None exist
(`p2p.joinSession` dials a peer; it does not create or join session state).

**What shipped:** the session-level `coHostIds`/`playbackOwnerId` state, their
store actions, the take/hand-off controls and the `App.tsx` owner check are
deleted. Playback-surface visibility now derives from one device-local input —
`hasLocalPlaybackSurface(session)`, true iff this device's `playbackProvider` is
Spotify. A participant on `playbackProvider: 'none'` gets **no playback surface
at all** (absent, not disabled). The coordinator's transport controls are
unchanged and labelled "Your Spotify" (tooltip: *controls this device's linked
Spotify account; session peers are unaffected*).

**Deferred, deliberately:** the session-message channel gets its own scoping
cycle and ADR. Its driving requirement is the P2P social layer — turn-taking,
presence, queue — and per the roadmap amendment below that layer is post-MVP, so
the channel currently has **no MVP consumer**: playback sync is doubly blocked
(participants cannot stream from Spotify under the Feb 2026 restrictions, and
audio distribution needs the file-transfer lane hardened first). "Now-playing
visibility for remote peers" is logged there as a candidate requirement, not
built here. `playlist.coHostIds` (schema v5) stays as-is — removing an unused
field would ship a v5→v6 migration to every local DB for no user benefit. The
mutex design survives on record in [[adr-260315-p2p-session-pairing]] and
[[epic-session-coordination]] (#36) to rebuild from.

#### Roadmap amendment (user ruling 2026-08-03)

The **P2P social layer (turn-taking, presence, queue) and the session-message
channel are post-MVP.** The social layer exists for the moment WhatNext decouples
from Spotify, and that moment needs *proven* P2P playlist and library sharing
first. This re-sequences `CLAUDE.md` §Development Roadmap Phase 1's "Social
layer: turn-taking, queue management, reactions, presence" line, which is
recorded here rather than silently contradicted; the `CLAUDE.md` edit itself is
the user's to apply. (In-session reactions and comments are unaffected — they
ride RxDB replication and stay in Phase 1.)

#### Two-peer QA script (WB5 checkbox 2)

Automated tests cover the decision points; the two-peer assertion is visual.

1. Peer A: start a session on a Spotify-linked playlist with **Playback: Spotify**. Peer B: join and start a session on the same playlist with **Playback: None**.
2. **Expect A:** the shell playback bar is present, labelled "Your Spotify"; transport controls drive A's Spotify Connect device as before.
3. **Expect B:** *no playback bar anywhere* — not greyed, not a placeholder, no "playback owned by …" text. B's session view is playlist collaboration only.
4. **Expect both:** no "You control playback", no "Take Playback" button, no "Hand off to…" dropdown, in either view.
5. Peer B: set **Playback: Spotify** instead, and confirm B now gets its own bar labelled "Your Spotify" — two independent device-local transports, neither claiming authority over the other.
6. Playlist edits on either peer still replicate both ways (regression check that nothing in the deletion touched replication).

## Epic Acceptance Criteria (Definition of Done)

- [x] #56, #57 closed; review §2 items (deadlock, companion auth, relay acks, playback mutex, poll cadence, name adoption) closed or explicitly re-ticketed with rationale. *(Re-ticketed follow-ups filed as #59/#60; playback mutex resolved by removal per the WB5 decision.)*
- [ ] All fixes covered by tests where the harness allows *(done — every cycle shipped with tests)*; live QA pass for companion (LAN + relay) and a 2-peer playback-ownership check. **Remains open: the human live-QA passes only** — WB4's phone-browser script and WB5's two-peer script cannot be automated.
- [x] `npm test` green; no new lint/typecheck failures; concept docs updated where behavior changed (companion auth flow, playback ownership contract).

## Risks & Open Questions

- ~~**Playback ownership scope**~~ — **resolved 2026-08-03**: neither replicate nor relabel. There is no session-message channel to extend (only a `whtnxt://` URL parser), the take/hand-off controls were unreachable, and the social layer that would consume such a channel is now post-MVP — so the ownership surface was **removed** and the channel deferred to its own ADR cycle. See WB5's decision record.
- ~~**Companion auth vs zero-friction join**~~ — **resolved 2026-08-02**: the PIN is embedded in the QR (as a URL fragment) so scanning stays one-step; the PIN field appears only for manually-typed links. **Amended from "4 digits" to 4 characters over the 32-symbol ambiguity-free alphabet** by user ruling — same friction, 105× the guess space, and a host-side lockout behind it.
- ~~**#57 fallback resolution**~~ — **resolved 2026-08-01**: no filesystem fallback at all. Deterministic `--print after_move:` reporting is already in place; when it yields nothing the track is marked "downloaded, not imported" rather than guessed at.
- **File overlap**: `useTrackSource.ts` is touched here only (trust-boundary lane doesn't enter renderer hooks) — but confirm at dispatch; `downloader-ipc.ts` is shared with [[epic-ipc-trust-boundary]] (disjoint hunks: validation-at-entry vs event flow).

## References

- Issues #56, #57; [[report-260801-mvp-premerge-review]] §2, §3
- Code: `app/src/renderer/hooks/useTrackSource.ts:27,190,298-303`; `app/src/renderer/hooks/usePlaylistDownload.ts:161`; `app/src/main/companion/companion-server.ts:151-167,177-179,325,431-436,565-616`; `relay/companion-tunnel.mjs:227-232`; `app/src/renderer/stores/navigation-store.ts:93-102`; `app/src/shared/session-interfaces.ts:52`; `service/downloader/` (spotDL/yt-dlp backends)
- Related: [[epic-audio-acquisition-hardening]] (landed), [[companion-client-spec]], [[epic-session-coordination]]
- Concepts: [[Companion-Client]], [[Sessions]], [[Spotify-Integration]]
