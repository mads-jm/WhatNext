# Implementation notes

**Brief:** .claude/cycle/brief.md (cycle started 2026-06-27)
**Epic:** WhatNext - docs/08 specs/epic-replication-reliability.md
**Lane:** replication-reliability (Wave 1, P2P-approved)
**Architect run:** 2026-06-27

## What I built
Hardened the five reliability surfaces of the P2P RxDB replication stack: durable
per-peer/per-collection checkpoints (#40), a non-silent pull-timeout plus
exponential-backoff relay reconnection with single-fallback and a liveness
heartbeat (#41), skew-aware epoch-ms LWW conflict resolution with a deterministic,
cross-peer-convergent tie-break (#42), backpressure-safe file-chunk sends so
>10MB transfers no longer reset the stream (#47), and a from-scratch Vitest P2P
harness with suites covering all of the above (#32). The `[[RxDB-Replication]]`
concept page is updated to document the new behavior. **No wire-protocol version
bump** — the protocol id stays `/whatnext/rxdb-replication/1.0.0`.

Note on provenance: I inherited a substantial, uncommitted draft of this work
already present in the worktree from a prior Architect pass. I reviewed every line,
fixed the defects I found (a flaky test, type errors, and a real LWW convergence
bug — see below), added missing coverage, verified, documented, and committed it.

## Design decisions

- **Decision:** Checkpoint store = a single debounced JSON file under `userData`,
  owned/written by the utility process (path derived from platform conventions,
  `WHATNEXT_CHECKPOINT_PATH` env override for tests).
  **Alternatives considered:** a dedicated RxDB collection in the renderer (the
  spec's other candidate).
  **Rationale:** a flat file is simpler and decoupled from the very DB being
  replicated; the renderer-collection option couples checkpoint durability to
  renderer liveness and the replicated dataset.
  **Tradeoff:** the utility process can't call `app.getPath('userData')`, so it
  re-derives the path from platform conventions — a small duplication of Electron's
  own logic that could drift if the app name changes. Mitigated by the env override
  and a corrupt/missing-file → full-resync fallback (degraded, never broken).

- **Decision:** On pull timeout, REJECT and echo the requester's incoming
  checkpoint back (do not advance); responder advances the checkpoint to the
  newest returned doc's `updatedAt`, never wall-clock `now`.
  **Alternatives considered:** keep "resolve empty + fresh checkpoint" (the bug);
  advance to `now` on success.
  **Rationale:** advancing on a timeout or to `now` silently skips unsent docs —
  the exact data-loss bug. Echoing the incoming checkpoint re-pulls next time.
  **Tradeoff:** a permanently-slow peer re-attempts the same pull each cycle
  (no progress) rather than declaring false success — correct, but it trades a
  silent wrong answer for a visible retry loop. Acceptable and observable.

- **Decision:** Relay backoff/fallback/heartbeat as pure, separately-tested
  helpers (`backoff.ts`, `nextFallbackAddress`, `checkRelayLiveness`).
  **Rationale:** keeps the schedule and ring-fallback policy unit-testable without
  a real libp2p network.
  **Tradeoff:** fallback is single-hop only (spec-scoped); multi-relay
  orchestration is explicitly out of scope.

- **Decision (correctness fix beyond the inherited draft):** LWW equal-timestamp
  tie-break uses a `contentKey()` projection that strips `id`, `updatedAt`,
  `addedAt`, and all `_`-prefixed RxDB-internal fields before stable
  serialization, applied identically to both the incoming `data` payload and the
  existing `RxDocument.toJSON()`.
  **Alternatives considered:** the inherited code compared
  `stableStringify(doc.data)` against `stableStringify(existingData)` — i.e. a
  transmitted user-fields payload against a full toJSON carrying `_rev`/`_meta`/
  `id`/`updatedAt`. That is heterogeneous and **non-symmetric across peers**, so
  on an exact-ms tie peer A and peer B could elect different winners and diverge —
  violating acceptance #42 ("identical on both peers").
  **Rationale:** every stripped key is non-discriminating at a tie (id equal,
  timestamps equal/creation-time) and removed identically from both sides, so
  `contentKey(data) === contentKey(toJSON)` for the same user content → symmetric
  and convergent.
  **Tradeoff:** relies on the residual assumption that the transmitted `data`
  carries the same user fields the stored doc does (which must hold for
  replication to function at all). Flagged under Uncertainty.

## Files changed
- `app/src/utility/checkpoint-store.ts` — NEW: durable, debounced, atomic JSON checkpoint store (#40).
- `app/src/utility/backoff.ts` — NEW: pure exponential-backoff-with-jitter helper (#41).
- `app/src/utility/relay-manager.ts` — backoff + ring fallback + liveness heartbeat (#41).
- `app/src/shared/p2p-config.ts` — new `RELAY` backoff/heartbeat constants + `REPLICATION.PULL_TIMEOUT`; deprecate `RETRY_INTERVAL` (#41).
- `app/src/utility/p2p-service.ts` — wire in the checkpoint store; reject pull timeouts; act on pull-response (#40, #41).
- `app/src/utility/protocols/replication.ts` — `newestCheckpoint()` + `onPullResponse` requester handler (#40/#41).
- `app/src/renderer/db/lww.ts` — NEW: skew-aware parse + symmetric `contentKey` tie-break (#42).
- `app/src/renderer/db/replication-handler.ts` — use `incomingWins`/`contentKey` instead of string compare (#42).
- `app/src/utility/protocols/file-transfer.ts` — `sendWithBackpressure` + per-stream serialized send queue; TODO removed (#47).
- `WhatNext - docs/01 concepts/RxDB-Replication.md` — document all of the above; explicit "no version bump" note (P2P doc requirement).
- Tests (#32): `app/src/utility/protocols/__tests__/{harness.ts,handshake.test.ts,replication.test.ts,file-transfer.test.ts}`, `app/src/utility/__tests__/{backoff,checkpoint-store,relay-manager}.test.ts`, `app/src/renderer/db/__tests__/lww.test.ts`.

## Tests
- **lww.test.ts** (26 cases): epoch parse of mixed precision/missing/numeric; updatedAt-over-addedAt; strictly-later wins; differing-precision equal instants as a tie; deterministic content tie-break; `contentKey` strips id/timestamps/`_`-fields; **explicit cross-peer convergence test** proving the two peers elect the same winner despite the data-vs-toJSON shape asymmetry.
- **checkpoint-store.test.ts**: round-trip + restart simulation; unknown-key null; corrupt/absent/non-string-value graceful degradation; unwritable-dir no-crash; debounce coalescing; no-op set; path resolution + env override.
- **backoff.test.ts**: monotonic growth, ceiling cap, jitter bounds, zero-jitter determinism.
- **relay-manager.test.ts**: `nextFallbackAddress` ring logic; backoff retry fires repeatedly; fallback to next relay on exhaustion; heartbeat detects half-open + reports live.
- **handshake.test.ts**: metadata exchange + reply; capability-mismatch surfaced not rejected; empty-stream no-op.
- **replication.test.ts**: `newestCheckpoint` selection/preservation/epoch-fallback; pull-request→pull-response; push→push-ack; pull-response forwarded to `onPullResponse`; backward-compat when callback omitted.
- **file-transfer.test.ts**: `sendWithBackpressure` waits for drain; serialized ordered writes; drop-with-no-stream no-throw; **>10MB reassembly with sha256 integrity** over the real receive path.

A shared `harness.ts` provides in-memory `MockStream`/`MockConnection`/`MockLibp2p`
(length-prefixed framing identical to the protocols) plus an `asLibp2p()` cast
helper that centralizes the one unavoidable structural mock→type assertion.

## Verification run
- `npm run test` (Vitest) — **PASS: 252 passed / 0 failed (16 files)**, stable across 9 consecutive full runs after fixes.
- Type-check (`tsc --noEmit`) — **src/ is CLEAN**. The only remaining `tsc` errors are environmental: type-resolution noise inside the *symlinked* `node_modules` (vite `#types/*` subpaths, libp2p-yamux `PromiseWithResolvers`) and `vite.config.ts` resolving `@tailwindcss/vite` through the symlink. These reproduce on the untouched main checkout and are the symlink artifact the dispatch brief anticipated.
- `npm run lint` (ESLint) — could not execute end-to-end: `eslint.config.js` uses ESM `import` but `app/package.json` sets `"type": "commonjs"`, so under this shell's Node v26 the flat config fails to load. **This is pre-existing and environmental** — it fails identically on the clean main checkout at HEAD. I verified my code by running eslint against a temporary `.mjs` copy of the config: **my changed files introduce zero new lint errors/warnings.** The only lint hits in my files are two pre-existing `(process as any).parentPort` casts in `p2p-service.ts` (present verbatim in HEAD; line numbers merely shifted by my additions) — I left them untouched (out of scope, not mine).

## Deviations from brief
- **Fixed a real LWW convergence bug in the inherited draft** (heterogeneous, non-symmetric tie-break) by adding `contentKey` and a convergence test. This is squarely within #42's acceptance ("identical on both peers") — I treat it as completing the issue, not exceeding it. Called out explicitly here per the no-silent-scope-creep rule.
- **Hardened the flaky `relay-manager.test.ts`** (test-only): under the concurrent suite + fake timers, the source's established `await import('@multiformats/multiaddr')` pattern didn't settle within the timer-advance window, so retries were missed ~50% of runs. Fixed in the TEST (not the source) with `vi.dynamicImportSettled()` + a bounded poll + a module stub. The production dynamic-import pattern is left intact (it mirrors `p2p-service.ts:835`).
- No wire-protocol version bump (spec-mandated; documented explicitly).

## Uncertainty
- **`contentKey` residual assumption** — convergence holds as long as the
  transmitted `data` carries the same user fields the stored doc does. If a future
  schema adds a server/RxDB-default-populated field that lands in `toJSON()` but is
  omitted from the replicated `data`, the tie-break could desync again. This only
  bites on an *exact-millisecond* timestamp tie (astronomically rare for
  independently-edited docs). Worth an Inspector eye on the exact push-side `data`
  shape (`useSessionReplication.ts` / wherever `pushChanges` builds documents).
- **Checkpoint path derivation** duplicates Electron's `userData` convention in the
  utility process. If the packaged app name/id ever differs from `WhatNext`, the
  derived path would miss and silently full-resync. Main could inject
  `WHATNEXT_CHECKPOINT_PATH` to remove the guess — deferred (not required by #40,
  and the degradation is graceful).
- **Heartbeat reuse** — I used a connection-membership check (`getConnections`)
  rather than extending the `ping` protocol as the spec floated. Lighter and
  test-deterministic, but it detects a dropped libp2p connection, not an
  application-level half-dead-but-connected peer. Adequate for the half-open-link
  case the spec named; flagged in case a true keepalive is wanted later.
- **Lint not run clean end-to-end** due to the pre-existing ESM-config/Node-version
  mismatch (see Verification). If the reviewer's environment runs Node v24 (the
  project's pinned version) lint should load normally.

## Deliberately deferred
- True `ping`-protocol keepalive heartbeat (membership check used instead).
- Multi-relay selection/orchestration (single-hop fallback only, per spec scope).
- Main-injected checkpoint path (env override hook is in place).

---

## Fix-pass (2026-06-27) — inspector blocking items

Focused pass resolving exactly the two blockers from `replication-verdict.md`. No other changes.

### Blocker [1] — non-convergent LWW equal-timestamp tie-break
- **Root cause:** sender strips device-local fields (`localFilePath`, `localFileSize`, `albumArtLocalPath`, `coverArtLocalPath`) from the transmitted `data`, but the receiver computed `contentKey(existing.toJSON())` over the *un*stripped stored doc. On an exact-ms tie the existing-side key carried e.g. `localFilePath` (sorts before `name`), so the incoming side always won on BOTH peers → content swap / oscillation.
- **Fix:** introduced a single shared constant `DEVICE_LOCAL_FIELDS` in `app/src/renderer/db/schemas.ts` (source of truth). `lww.contentKey` now drops these fields (merged into `NON_CONTENT_KEYS`), and the sender in `useSessionReplication.ts` now strips by iterating that same constant (replacing the per-collection hard-coded `delete`s). Sender-strip and tiebreak-strip can no longer drift.
- **Scope:** receiver-side tie-break only. Wire format, message types, and protocol id `/whatnext/rxdb-replication/1.0.0` unchanged.

### Blocker [2] — convergence regression test
- Added two cases to `lww.test.ts`:
  1. `contentKey` equality when the stored doc carries all four device-local fields (+ `_rev`) vs the stripped transmitted payload.
  2. Full convergence assertion on an equal-timestamp tie where only one peer has `localFilePath`/`localFileSize` set — asserts both peers elect the same winner (`qWinsOnP === !pWinsOnQ`). This is the exact production shape the prior fixture omitted.

### Doc reconciliation
- `WhatNext - docs/01 concepts/RxDB-Replication.md` § Conflict Resolution: added a bullet stating device-local fields are excluded from the content tie-break key, with the single-source-of-truth note.

### Verification
- `npm run typecheck` — clean for `src/`; only the pre-existing `vite.config.ts` / `@tailwindcss/vite` node_modules baseline error remains (known, out of scope).
- `npx vitest run` (full suite) — **254 passed / 0 failed (16 files)** (252 baseline + 2 new lww cases).
- `npm run lint` — not run (pre-existing env-broken eslint flat-config, out of scope per brief).
