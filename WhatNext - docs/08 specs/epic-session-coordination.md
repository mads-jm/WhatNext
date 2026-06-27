---
tags:
  - specs/sessions
  - core/sessions
  - architecture/companion
status: draft
date created: 2026-06-27
date modified: 2026-06-27
---

# Epic: Session Coordination

**Status**: Draft
**GitHub**: #36, #43, #39
**Depends on**: [[epic-replication-reliability]] (mutex/turn state syncs over replication)
**Source audit**: [[report-260627-mvp-state-of-the-union]] §3

> ⚠️ The playback mutex (#36) touches the P2P protocol — needs explicit human approval before agentic work (CLAUDE.md / `needs-p2p-review`).

> This epic builds the "who controls what, when" layer of a live session: a single-controller playback mutex with handoff (#36), conflict-free turn advancement across peers (#43), and a bidirectional companion-phone control path so phone participants can act, not just watch (#39). All three are currently *schema-and-scaffold only* — the fields, message types, and a renderer bridge exist, but nothing enforces ownership, deduplicates turn advances, or fans phone input back into the session.

## Problem & Current State

A WhatNext session today has four participant roles (host / co-host / desktop participant / companion — see [[Sessions]]), but coordination between them is largely *implied by data* rather than *enforced by logic*. Three gaps make multi-peer sessions feel uncoordinated or unsafe:

1. **No playback mutex.** `SessionState` carries `coHostIds` (`app/src/shared/session-interfaces.ts:51`) and `playbackOwnerId` (`:52`), but they are inert schema fields — no code reads `playbackOwnerId` to gate playback control. Every peer's `usePlaybackState` independently polls Spotify (`app/src/renderer/hooks/usePlaybackState.ts`, `POLL_INTERVAL_MS = 3000`, despite the "5 seconds" docstring) and any peer can issue transport commands. Control is effectively first-writer-wins with no negotiation, grant, or handoff.

2. **Turn advancement is non-idempotent and distrusted.** `advanceTurn` (`app/src/renderer/db/services/playlist-service.ts:196`) is invoked from *two independent triggers* that can both fire for the same logical turn:
   - the counter path inside `addTrackToPlaylist` when `turnFull` (`playlist-service.ts:161-163`), and
   - a reactive `useEffect` in the UI when the *history-derived* quota is full (`app/src/renderer/components/Playlist/TurnManagementPanel.tsx:151-156`).
   Because the stored `currentTurnUserId` is considered unreliable (tracks added via Spotify sync bypass the service path), the panel *re-derives* `effectiveTurnUserId` from track history rather than trusting the DB (`TurnManagementPanel.tsx:126` comment → `:139`). Concurrent adds — or the same add observed on two peers — can advance the turn twice, and there is no cross-peer coordination of who advances.

3. **Companion phones are snapshot-only.** The companion server already *receives and handles* phone→server `reaction` and `time-request` messages (`app/src/main/companion/companion-server.ts:191`, `:211`; ack at `:434`) and the protocol defines them (`app/src/main/companion/companion-protocol.ts:71-72`). But the renderer hook that would surface those events into session logic — `app/src/renderer/hooks/useCompanionBridge.ts` — is **orphaned**: it is never imported anywhere (confirmed by grep; flagged in [[dead-code-audit-260322]]). `CompanionSharePanel.tsx` starts the server directly but does not consume reactions, time-requests, or push host-side actions. So a phone can *send* a reaction and the desktop will broadcast it to other phones, but nothing in the WhatNext session (reactions feed, turn timer, queue) reacts to it.

Session state lives in the navigation store (Zustand, in-memory, per CLAUDE.md), while collaborative playlist data syncs via RxDB replication. Coordination state therefore has to choose its home deliberately: ephemeral control (who *currently* holds the mutex) vs. durable record (turn counters already on the playlist schema).

## Goals

- **G1 — Single-controller playback.** Exactly one participant (`playbackOwnerId`) may drive transport at a time; every peer agrees on who that is, and the UI reflects it.
- **G2 — Conflict-free handoff.** Ownership can be granted, requested, revoked, and transferred deterministically, surviving concurrent claims without two owners or a lost owner.
- **G3 — Idempotent, coordinated turn advancement.** A logical turn advances exactly once regardless of how many peers observe the triggering add or how many triggers fire.
- **G4 — Trustworthy turn state.** Reduce or eliminate the need for the UI to re-derive `effectiveTurnUserId` from history by making the stored turn state authoritative.
- **G5 — Bidirectional companion control.** Phone participants can send reactions, request more time, and (where role permits) perform queue/playback actions that fan back into the live session.
- **G6 — Role-gated authority.** All control actions are gated by participant role (host / co-host vs. desktop participant vs. companion) consistently across desktop and companion surfaces.

## Non-Goals

- Replacing LWW with CRDTs (tracked under the conflict-resolution migration; LWW is the MVP baseline).
- Multi-room / multiple simultaneous active sessions per app instance.
- Companion *audio playback* on the phone — companions remain remote controllers/viewers, not playback devices.
- Spotify-side write-back / Proxy Owner mode (Phase 2 per CLAUDE.md roadmap).
- Reworking the track-sourcing poll loop itself — see [[epic-track-sourcing]]; this epic only consumes its outputs.

## Proposed Approach

Treat coordination as a small, explicit **session control protocol** layered on the existing session abstraction ([[adr-260307-session-architecture-provider-abstraction]]):

1. **Ownership state machine (mutex).** Model `playbackOwnerId` as the single source of truth for transport authority with a minimal state set — `unowned → owned(by X) → transferring(X→Y) → owned(Y)` — plus grant/request/revoke transitions. Replicate the authoritative value so all peers converge; use a deterministic tie-break (e.g. host wins, else lowest userId / highest logical clock) for simultaneous claims. Gate `usePlaybackState`-driven commands and the playback UI on `playbackOwnerId === currentUserId`.

2. **Turn-advance coordinator.** Collapse the two advancement triggers into one idempotent path keyed by a *turn token* (e.g. `(playlistId, turnsCompleted)` or a monotonic turn id). An advance is a no-op if the token has already been consumed, so duplicate observers and the counter/history double-trigger become safe. Make stored turn state authoritative enough that `TurnManagementPanel` can trust `currentTurnUserId` (closing G4) instead of re-deriving at `:139`.

3. **Companion control path.** Adopt (and de-orphan) `useCompanionBridge` as the integration seam: wire phone→server `reaction`/`time-request` (and new control messages) up through IPC into session logic — reactions into the session reactions feed, time-requests into the turn timer, and role-permitted queue/playback actions through the same mutex + turn coordinator the desktop uses. Extend `companion-protocol.ts` with the minimal new message types needed for queue/playback control rather than inventing a parallel path.

**Sequencing note:** the mutex and turn coordinator both depend on reliable cross-peer state, so [[epic-replication-reliability]] is a hard prerequisite for the *distributed* guarantees (single-instance correctness can land first behind it).

## Work Breakdown

### #36 — Playback mutex / co-host ownership

**Rationale.** `playbackOwnerId` exists only as a schema field (`session-interfaces.ts:52`); nothing enforces it. Without a mutex, two peers polling Spotify (`usePlaybackState.ts`) can issue conflicting transport commands — the classic "two people hit play" problem. ⚠️ This is P2P-protocol-adjacent and requires human approval before agentic implementation.

**Proposed approach.**
- Define an ownership state machine over `playbackOwnerId`: `unowned`, `owned(userId)`, `transferring(from,to)`.
- Transitions: `claim` (take an unowned mutex), `request` (ask current owner), `grant` (owner/host hands to target), `revoke` (host force-reclaim), `release` (owner drops to unowned).
- Replicate the authoritative owner so all peers converge; resolve simultaneous claims with a deterministic tie-break (host precedence, then lowest userId or highest logical clock).
- Gate transport: playback commands and the play/pause/seek UI are enabled only when `playbackOwnerId === currentUserId`; others see a read-only/"request control" affordance.
- Grant/revoke/handoff UI surfaced to host and co-hosts.

**Acceptance criteria.**
- [ ] At any instant, all connected peers agree on a single `playbackOwnerId` (or `unowned`).
- [ ] Non-owners cannot issue transport commands (enforced, not just hidden).
- [ ] Owner can hand off control; target becomes owner and both UIs update.
- [ ] Host can revoke control from any owner.
- [ ] Two simultaneous `claim`/`request` events resolve to exactly one owner with no lost-mutex state.
- [ ] Ownership state survives a peer disconnect/reconnect (owner leaving releases or reassigns per policy, not strands the mutex).
- [ ] Companion participants' control requests honor the same mutex (ties into #39).

### #43 — Turn-advance coordination

**Rationale.** `advanceTurn` (`playlist-service.ts:196`) can fire twice for one logical turn because it is triggered both by the counter path in `addTrackToPlaylist` (`:161-163`) and by a history-derived `useEffect` in `TurnManagementPanel` (`:151-156`). The UI does not trust stored turn state and re-derives `effectiveTurnUserId` from track history (`TurnManagementPanel.tsx:126` → `:139`), which is a symptom, not a fix. Across peers there is no coordination of *who* advances.

**Proposed approach.**
- Introduce a **turn token** (monotonic id or `(playlistId, turnsCompleted)` tuple) consumed atomically by `advanceTurn`; advancing an already-consumed token is a no-op.
- Collapse the counter-path and history-path triggers so both route through the single idempotent `advanceTurn`, making double-fire and multi-observer advances safe.
- Make stored `currentTurnUserId` authoritative (fix the Spotify-sync bypass that motivated the re-derivation) so `TurnManagementPanel` can trust the DB instead of inferring at `:139`.
- Define cross-peer ownership of advancement (e.g. host/owner advances; others observe) consistent with the #36 mutex, or make advancement fully commutative via the token so any peer may advance once.

**Acceptance criteria.**
- [ ] Adding the quota-completing track advances the turn exactly once, even with the counter and history triggers both active.
- [ ] Concurrent adds on two peers do not double-advance (token dedupe holds across peers post-replication).
- [ ] `TurnManagementPanel` renders the correct current turn from stored state without re-deriving from history (or the re-derivation becomes a redundant cross-check, not the source of truth).
- [ ] Spotify-sync-added tracks correctly advance the turn through the same idempotent path.
- [ ] `maxTurns` auto-complete still fires exactly once.

### #39 — Companion bidirectional control

**Rationale.** The companion phone is snapshot-only in app logic. `reaction`/`time-request` are defined (`companion-protocol.ts:71-72`) and the *server* handles them (`companion-server.ts:191`, `:211`, ack `:434`), but the renderer bridge that would surface them into the session — `useCompanionBridge.ts` — is orphaned/never imported ([[dead-code-audit-260322]]). So phone input never reaches the session's reactions feed, turn timer, or queue.

**Proposed approach.**
- De-orphan `useCompanionBridge` (or fold its logic into the active session view) as the single seam between the companion IPC events and session state.
- Wire phone→host inbound events: `reaction` → session reactions feed; `time-request` → turn-timer extension flow with host ack (`respondToTimeRequest` already exists in the bridge).
- Add role-gated queue/playback control messages to `companion-protocol.ts` (e.g. `queue:add`, `playback:command`) that route through the same #36 mutex and #43 turn coordinator rather than a parallel path.
- Surface companion identity/role so the desktop can authorize actions (companion ≠ co-host by default).

**Acceptance criteria.**
- [ ] `useCompanionBridge` (or its successor) is imported and active during a live session.
- [ ] A phone reaction appears in the desktop session's reactions feed in near-real-time.
- [ ] A phone time-request reaches the host UI and a host ack ("seen"/"granted") flows back to the phone.
- [ ] A role-permitted companion queue add inserts into the session queue and replicates to peers.
- [ ] A companion playback/control action is rejected (and the phone is told) unless the companion currently holds the #36 mutex / is permitted by role.
- [ ] Companion actions respect the turn coordinator (cannot bypass turn rules).

## Epic Acceptance Criteria (Definition of Done)

- [ ] Exactly one playback owner is agreed across all peers at all times; non-owners cannot drive transport (#36).
- [ ] Ownership handoff, request, and host revoke work and converge across peers (#36).
- [ ] A logical turn advances exactly once under all trigger combinations, single- and multi-peer (#43).
- [ ] Stored turn state is authoritative; UI no longer needs history re-derivation as its source of truth (#43).
- [ ] Phone participants can react, request time, and perform role-permitted queue/playback actions that fan back into the session (#39).
- [ ] All control actions are consistently role-gated across desktop and companion surfaces.
- [ ] All distributed guarantees hold over RxDB replication ([[epic-replication-reliability]]).
- [ ] Human review obtained for all P2P-protocol-touching changes (#36) per CLAUDE.md.

## Risks & Open Questions

- **Where does mutex state live?** Ephemeral control naturally fits the in-memory navigation store, but cross-peer convergence needs a replicated home. Does `playbackOwnerId` move onto a replicated document, or do we add a small replicated control collection? *(Open — depends on [[epic-replication-reliability]] design.)*
- **Owner-leaves policy.** When the mutex owner disconnects, do we auto-release to `unowned`, fall back to host, or hold until reconnect? *(Open.)*
- **Tie-break authority.** Is host-precedence acceptable, or do we need a logical clock / Lamport timestamp for fairness between co-hosts? *(Open.)*
- **Turn token shape.** Is `(playlistId, turnsCompleted)` sufficient, or do reorders/removals require a standalone monotonic turn id? *(Open.)*
- **Spotify-sync bypass.** Making stored turn state authoritative requires routing Spotify-synced adds through the same advancement path — does the two-phase poll in [[epic-track-sourcing]] make that feasible without regressing sync latency? *(Open — cross-epic dependency.)*
- **Companion authority model.** Default companion role is viewer; what is the explicit grant flow for a companion to gain queue/playback rights, and can a companion ever hold the playback mutex? *(Open.)*
- **Replication latency vs. UX.** Mutex grant and turn advance must feel instant locally while remaining safe under replication lag — optimistic local apply with reconciliation? *(Open.)*
- **P2P-review gating.** #36 cannot proceed agentically; sequencing must front-load the human-approval step. *(Process risk.)*

## Dependencies & Sequencing

- **Hard prerequisite:** [[epic-replication-reliability]] — distributed mutex and cross-peer turn dedupe both rely on reliable replicated state. Single-instance correctness for #43 and #39 can land first; distributed guarantees follow replication hardening.
- **Cross-epic:** [[epic-track-sourcing]] — the Spotify-sync bypass that forces turn re-derivation originates in the track-source poll loop; G4 depends on that path feeding the idempotent `advanceTurn`.
- **Suggested order:**
  1. #43 single-instance idempotency (turn token, collapse triggers) — lowest risk, no P2P review.
  2. #39 inbound companion path (de-orphan bridge, reactions + time-requests) — no P2P review.
  3. #36 mutex — gated on human P2P approval and on replication reliability; the distributed pieces of #43 and #39's control actions layer on top.

## References

- Source audit: [[report-260627-mvp-state-of-the-union]] §3
- Concepts: [[Sessions]], [[Companion-Client]]
- Specs: [[companion-client-spec]]
- ADRs: [[adr-260307-session-architecture-provider-abstraction]], [[adr-260315-companion-client-architecture]]
- Related epics: [[epic-replication-reliability]], [[epic-track-sourcing]]
- Dead-code context: [[dead-code-audit-260322]]
- Code:
  - `app/src/shared/session-interfaces.ts:51-52` — `coHostIds`, `playbackOwnerId` (inert)
  - `app/src/renderer/hooks/usePlaybackState.ts` — per-peer Spotify polling, no coordination
  - `app/src/renderer/db/services/playlist-service.ts:161-163`, `:196` — counter-path advance + `advanceTurn`
  - `app/src/renderer/components/Playlist/TurnManagementPanel.tsx:151-156`, `:126→:139` — history-path advance + re-derived turn
  - `app/src/main/companion/companion-protocol.ts:69-73` — phone→server messages
  - `app/src/main/companion/companion-server.ts:191`, `:211`, `:434` — reaction/time-request handling + ack
  - `app/src/renderer/hooks/useCompanionBridge.ts` — orphaned bridge (never imported)
  - GitHub: #36, #43, #39
