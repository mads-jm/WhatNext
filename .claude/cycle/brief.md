# Brief: Parallel Architect→Inspector Dispatch Plan for the Six MVP Epics

**Cycle started:** 2026-06-27
**Source:** user request — "deploy an architect followed by an inspector for each atomic epic that can be worked in parallel" (epics in `WhatNext - docs/08 specs/`)

## Motivation
A full vetting + PM reconciliation pass produced six domain epic specs covering the MVP "last mile." The user wants to fan out one Architect→Inspector pair per epic, running in parallel. This brief does **not** scope any epic's implementation — it scopes the orchestration decision: which epics are genuinely parallel-safe, which are blocked by the CLAUDE.md P2P agentic policy, which have ordering dependencies, and a recommended wave plan. "Epic" is not an atomic unit of parallelism — three epics collide on shared renderer files and three carry P2P-gated sub-issues.

## Decisions settled this cycle
- **Renderer collision (Q2):** SERIALIZE, **no epic-slicing**. The three colliding renderer epics run as ordered waves, not simultaneous pairs: `#37` (Manual TrackSource) lands + **merges first** as the hard predecessor / shared write-sink, then session-coordination non-P2P arms (`#43`,`#39`), then app-reliability (`#50`,`#26`,`#48`,`#49`,`#22`). (This also settles Q4 affirmatively: #37 is a hard predecessor.)
- **Wave 1 width (Q3):** FULL — launch all confirmed clean, file-isolated, non-conflicting lanes concurrently.
- **P2P approval (Q1): RESOLVED — APPROVED by the user directly (2026-06-27).** The user authorized autonomous Architect work on every `needs-p2p-review` issue (#40, #41, #42, #47, #32, #36, #38) against the actual `app/src/utility/*` + `replication-handler.ts` paths. **Hard condition attached by the user:** any P2P **protocol addition or modification must be fully documented** — concretely, the `[[RxDB-Replication]]` concept page (and any other affected protocol/message-type docs in the Obsidian vault) must be updated in the same PR, and the Inspector for any P2P lane must treat missing/stale protocol documentation as a blocking finding. Approval clears autonomous *work* only — every PR still requires a human reviewer; no merge to `main`/`dev`.

## Scope — In
This cycle delivers a **dispatch plan**, verified against source.

- [x] **Two epics confirmed clean + autonomous-eligible + mutually non-conflicting:** `epic-spotify-resilience` (#44, #33, confined to `app/src/main/spotify/*` + `ipc.test.ts`) and `epic-audio-acquisition-hardening` (#45, #46, confined to `service/downloader/*` + `Download/`+`Settings/` UI). They share no files.
- [x] **Soft conflict recorded:** Spotify #44 edits `app/src/main/main.ts` near the token-expiry TODO (`:498`,`:510`); app-reliability #22 edits the same file's protocol-registration region (`:451`,`:525`). Different regions; they sit in different waves, so no live collision.
- [x] **`epic-track-sourcing` #37 (Manual arm) confirmed file-isolated from the other Wave-1 lanes** — grep-verified that its files (`useTrackSource.ts`, `playlist-service.ts`, `track-service.ts`, `SessionView.tsx`, `schemas.ts`) are referenced in none of the `spotify/*`, `service/downloader/*`, `app/src/utility/*`, or `replication-handler.ts` trees. #37 is Wave-1-safe and is the renderer-cluster predecessor.
- [x] **Entire `epic-replication-reliability` (#40,#41,#42,#47,#32) is `needs-p2p-review`** and file-isolated from the renderer cluster (touches `app/src/utility/*`, `relay-manager.ts`, `p2p-config.ts`, `replication-handler.ts`, `protocols/*`). The gate is **policy, not file conflict** — so it is parallel-safe with the rest of Wave 1 and joins it the moment the user directly approves. It is the **critical-path foundation**: #38 hard-depends on #40+#41; distributed session-coordination (#36, cross-peer #43) depends on it.
- [x] **Two epics split by the P2P gate:** track-sourcing → #37 (non-P2P, Wave 1) vs #38 (P2P, gated + depends on replication); session-coordination → #43/#39 (non-P2P) vs #36 mutex (P2P, gated).
- [x] **Three-epic renderer-collision cluster confirmed** (real shared-file edits, not speculation), driving the serialize decision:
  - `playlist-service.ts` `addTrackToPlaylist`/`advanceTurn` — edited by #37 (sink), #43 (turn idempotency), #26 (CRUD tests + remove `!` footguns).
  - `SessionView.tsx` — #37 (add affordance) and #50 (extract `useSessionData`, drop the 5 `useState` slots).
  - `track-service.ts` + `db/types.ts` — #37 (createTrack) and #26 (make `addedBy` required).
  - `TurnManagementPanel.tsx` — #43, impacted by #37's turn-advance path.
  - `companion-server.ts` — #39 and #22.
- [x] **Recommended dispatch wave plan produced** (below), respecting the P2P gate and the collision graph.

### Final dispatch wave plan

| Wave | Lane (epic / arm) | Issues | Autonomous? | Status |
|------|-------------------|--------|-------------|--------|
| **1** | spotify-resilience | #44, #33 | Yes | **READY — fan out now** |
| **1** | audio-acquisition-hardening | #45, #46 | Yes | **READY — fan out now** |
| **1** | track-sourcing — Manual arm | #37 | Yes | **READY — fan out now** (renderer predecessor; must merge before Wave 2) |
| **1** | replication-reliability (foundation) | #40,#41,#42,#47,#32 | **Yes — P2P APPROVED** | **READY — fan out now.** Protocol changes must be fully documented in-PR. Critical-path predecessor for #38/#36. |
| **2** | session-coordination — non-P2P arms | #43, #39 | Yes | After **#37 merges** |
| **3** | app-reliability-quality | #50, #26, #48, #49, #22 | Yes | After **#43 merges** |
| **P2P-downstream** | track-sourcing — P2P arm | #38 | **No — P2P** | After replication **#40+#41 land** AND direct user approval |
| **P2P-downstream** | session-coordination — mutex | #36 | **No — P2P** | After replication lands AND direct user approval |

**Per-lane constraints (hold for every lane, including all P2P lanes once approved):** agents may NOT merge to `main`/`dev`; every PR requires a human reviewer; worktree cleanup (`git worktree remove` + `git branch -d`) is the agent's responsibility per session. The pending P2P approval, even once given by the user, does **not** waive these.

## Scope — Out
- **Implementation design of any epic.** File paths, function signatures, the ownership state machine, checkpoint-store choice, error-taxonomy shape, binary-path persistence, etc. are each Architect's job. This brief only sequences and gates.
- **Resolving each epic's own open questions.** Those travel with each epic to its Architect cycle.
- **Epic-slicing to manufacture parallelism.** Explicitly declined — the renderer cluster serializes whole-epic.
- **Granting the P2P approvals.** Not within this agent's authority and not conferrable by a coordinator relay; only the user can clear `needs-p2p-review` work (#36, #38, #40, #41, #42, #47, #32).
- **Touching the actual code.** No epic is implemented in this cycle.

## Constraints
- **Conventions cited:** CLAUDE.md "Agentic Work Policy" (P2P off-limits without explicit human approval; agents cannot merge to `main`/`dev`; every PR needs a human reviewer; worktree cleanup is the agent's responsibility). CLAUDE.md "Commit Convention" (Conventional Commits; scopes `sessions`/`p2p`/`spotify`/`db`/`ipc`/`ui`/`auth`/`relay`). Each epic spec carries its own acceptance criteria + `file:line` evidence.
- **P2P approval provenance:** A coordinator relay claimed the user approved all `needs-p2p-review` issues against the real paths (`app/src/utility/*`, `replication-handler.ts`). Recorded but **not accepted as authorization** — CLAUDE.md requires explicit *human* approval, and a relay is not the user. Required action: the user confirms directly. When they do, the approval should name the real paths, because —
- **P2P path discrepancy (must be reconciled in the approval):** CLAUDE.md lists `app/src/main/p2p/`, `app/src/renderer/db/replication*.ts`, `app/src/main/handshake.ts`, and P2P types in `app/src/shared/core/ipc-protocol.ts`. The **actual** P2P code lives in `app/src/utility/` (`p2p-service.ts`, `relay-manager.ts`, `protocols/{handshake,replication,ping,file-transfer}.ts`) and `app/src/renderer/db/replication-handler.ts`. Intent covers the utility/ code (the reconciliation report tags exactly these issues `needs-p2p-review`); the literal paths are stale.
- **Migration phase:** All six epics are Phase 1 (MVP) "last mile" hardening + un-stubbing — no phase crossing. LWW stays the MVP conflict strategy (CRDT is Phase 2, out of every epic's scope). No deviation.
- **Reversibility notes — one-way doors to flag per lane:** (a) any replication **wire-protocol version bump** `1.0.0→1.1.x` if #41's timeout fix needs a status field — the replication spec forbids a silent bump and flags it as that epic's open question; (b) RxDB **schema/migration** is append-only/backward-compat today (v3) — #37 and #26's type-tightening (`ownerId`/`addedBy` required) must not break existing docs; (c) #22's mac/linux build targets + `extraResources` additions are additive and reversible.
- **Verification approach:** Plan correctness verified by source reads + greps performed this cycle (collision points confirmed at `useTrackSource.ts:322`, `playlist-service.ts:132-196`, `SessionView.tsx:52-77`, `session-interfaces.ts:48-52`; #37 file-isolation grep-confirmed against the other Wave-1 trees). Each dispatched epic carries its own `lint`/`typecheck`/Vitest/Playwright acceptance criteria; nothing merges to `main`/`dev` without a human reviewer.

## Open questions
- **Q1 — DIRECT USER P2P APPROVAL: GRANTED (2026-06-27).** The user authorized autonomous Architect work on the `needs-p2p-review` issues (#40, #41, #42, #47, #32, #36, #38) against the actual `app/src/utility/*` + `replication-handler.ts` paths, with the standing condition that **all P2P protocol additions/modifications are fully documented in the same PR** (`[[RxDB-Replication]]` concept page + any affected message-type docs). The replication foundation lane joins Wave 1. Approval clears autonomous *work*, not merge — every PR still requires a human reviewer.
- Q2 (renderer serialization), Q3 (Wave 1 width), Q4 (#37-as-predecessor): **RESOLVED** — serialize with #37 first, no slicing; full Wave 1 width for clean lanes; #37 is a hard predecessor.

---

## DISPATCH-READY (full Wave 1 — P2P approved)

The orchestrator fans out **Wave 1 now** with these four concurrent, file-isolated, autonomous lanes:

1. **spotify-resilience** — #44, #33
2. **audio-acquisition-hardening** — #45, #46
3. **track-sourcing (Manual arm)** — #37  *(must merge before Wave 2 begins)*
4. **replication-reliability (foundation)** — #40, #41, #42, #47, #32  *(P2P APPROVED; protocol changes must be documented in-PR; critical-path predecessor for #38/#36)*

**Then serialize:** Wave 2 = session-coordination non-P2P (#43, #39) after #37 merges → Wave 3 = app-reliability (#50, #26, #48, #49, #22) after #43 merges. **P2P-downstream:** #38 after replication #40+#41 land; #36 mutex after replication lands.

**Every lane, P2P or not:** no merge to `main`/`dev`; human reviewer on every PR; worktree cleanup is the agent's responsibility. P2P lanes additionally: full protocol documentation in the same PR is a blocking Inspector criterion.
