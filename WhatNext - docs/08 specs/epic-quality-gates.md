---
tags:
  - specs/quality
  - specs/security
  - core/development
status: in-progress
date created: 2026-08-01
date modified: 2026-08-05
---

# Epic: Quality Gates & Dependency Hygiene

**Status**: In progress — work items 1 & 2 implemented 2026-08-05 (cycle 1), plus the CI test job; work item 3 (lint burn-down) deferred to cycle 2, to be dispatched after [[epic-file-transfer-guards]]' `receive-path-lifecycle` lands
**GitHub**: to be filed (plan-first)
**Depends on**: none — but **sequence last** among the wave-2 lanes (lint burn-down touches many files; running it concurrently with other lanes invites conflicts)
**Source audit**: [[report-260801-mvp-premerge-review]] §1.6, §2 (gate repair), §7

> Two of the repo's three quality gates are red for reasons that have nothing to do with the code: typecheck fails on environmental noise (zero source errors) and lint — which only *runs* at all since the wave-1 config fix — reports 59 pre-existing errors. A permanently-red gate is worse than no gate: it trains everyone to ignore red, which is how real regressions ship. Separately, the `ws` WebSocket library is locked below the CVE-2026-45736 fix in both network-listening workspaces (merge-blocker #6). This epic makes all three gates green-and-meaningful and clears the dependency advisory.

## Problem & Current State

Verified on the integrated tree (now mvp `cafc6ab`) 2026-08-01:

1. **`ws` below CVE fix (blocking, trivial)** — `app/package-lock.json` resolves ws **8.19.0**, `relay/package-lock.json` **8.20.0**; CVE-2026-45736 (information disclosure) is fixed in **8.20.1**. Both ranges (`^8.19.0`/`^8.20.0`) already allow the fix — this is purely a lockfile refresh. The companion server and relay tunnel are network-listening consumers.
2. **Typecheck red, 100% environmental** — `cd app && npm run typecheck`: every error is `node_modules` `.d.ts` resolution noise or `vite.config.ts` under the current `moduleResolution`; zero source errors. Review direction: `"skipLibCheck": true` plus `moduleResolution: "bundler"` for the vite-config context.
3. **Lint: 59 errors / 16 warnings** across ~28 files — mostly `no-explicit-any` and unused vars. Pre-existing debt revealed (not created) by the wave-1 config fix. *(Re-measured at mvp `413e6bf` 2026-08-05: **55 errors / 16 warnings**, unchanged by cycle 1.)*
4. **CI consequence**: every wave-1 PR showed failing Lint/TypeCheck checks that had to be merged past by hand — the gates are currently decorative.

## Goals

- `ws` ≥ 8.20.1 resolved in app and relay lockfiles.
- `npm run typecheck` green with **zero suppressed source errors** — config fixes only for the environmental noise; any real source error found along the way gets fixed, not silenced.
- `npm run lint` green: fix the 59 errors (typed replacements for `any` where cheap, targeted disables with justification comments only where a real type isn't practical; delete genuinely unused vars).
- CI on mvp goes green so a red check means something again.

## Non-Goals

- No new lint rules, no rule-set redesign, no formatting churn beyond what fixes require.
- No behavioral changes: this lane must be a no-op at runtime. Any lint fix that would change behavior (e.g. an "unused" var that's actually a bus subscription) gets a disable-with-comment instead, flagged in impl notes.
- Vitest 2→3 major bump (review flagged it as "plan before the gap grows" — ticket it, don't do it here).
- Fixing other lanes' new code — they own their own lint/type cleanliness.

## Proposed Approach

1. **ws bump**: `npm update ws` in `app/` and `relay/`; verify resolved versions ≥ 8.20.1; run app tests + a relay smoke start.
2. **Typecheck config**: add `skipLibCheck` and adjust the vite-config context (`tsconfig` for `vite.config.ts` with `moduleResolution: "bundler"`); confirm zero source errors remain (the review pre-verified none exist today).
3. **Lint burn-down**: sweep by rule (unused vars first — deletions; then `no-explicit-any` — real types where the shape is at hand, `unknown` + narrowing where it isn't, justified disables last). Commit in small per-area chunks so review is tractable.
4. **Verification**: full `npm test` after each sweep chunk (lint fixes love to break subtle things); final CI-green check on the mvp PR.

## Work Breakdown

### 1 — `ws` CVE bump (review §1.6, punch-list item 6) — ✅ done 2026-08-05 (cycle 1)

**Scope correction:** the epic named app and relay. `service/` is a **third** network-listening consumer (`service/src/server.ts` runs a `WebSocketServer` on :3001) and was ruled in by the user on 2026-08-05. `test-peer` resolves ws 6.2.3 as a transitive peer dep of an unrelated package — different major, dev-only harness, out of scope.

**Acceptance criteria.**
- [x] `app`, `relay`, **and `service`** lockfiles resolve `ws` **8.21.2** (was 8.19.0 / 8.20.0 / 8.18.3). Declared ranges unchanged — all three already admitted the fix, so this is purely a lockfile refresh.
- [x] App test suite green (553 tests, 39 files — unchanged). Relay smoke: `companion-tunnel.mjs` started on an OS-assigned port against relay's *own* `node_modules`, `POST /session` returned 200 and a real `ws` client completed the upgrade. Service smoke: `npx ts-node src/server.ts` started, `GET /` and a `ws` upgrade both succeeded on :3001.
- [x] Lockfile diffs are the bump and nothing else — 5 ws entries in `app`, 1 each in `relay`/`service`, no other package moved.

**Residual, not fixable in this lane:** `app/node_modules/rxdb/node_modules/ws` stays at **8.18.3** because rxdb pins ws to that *exact* version (`"ws": "8.18.3"`, no range). It is not reachable at runtime — nothing in the tree imports `rxdb/plugins/replication-websocket`; replication runs over libp2p. Clearing it needs an rxdb upgrade or an `overrides` entry, both larger than a lockfile refresh. **Follow-up, plan-first.**

**Free-riders, kept:** `npm update ws` also moved app's nested peer-dep copies (react-native/@react-native-dev-middleware 6.2.3 → 6.2.6, metro/react-devtools-core 7.5.10 → 7.5.13) — same package, same security backport line, within their existing ranges.

### 2 — Typecheck gate repair — ✅ done 2026-08-05 (cycle 1)

**Measured baseline at mvp `413e6bf`:** **16** errors, **all environmental, zero in `src/`** — confirming the review's 4-day-old claim about both the kind and the count. 15 in `node_modules` `.d.ts` (1 × `PromiseWithResolvers` in `@chainsafe/libp2p-yamux`; 13 × vite/vitest `#types/*` subpath imports and `rollup/parseAst` unresolvable under `moduleResolution: "node"`; 1 × TS2403 duplicate global `gc` in `@types/node/globals.d.ts`), 1 in `vite.config.ts` (`@tailwindcss/vite`, same resolution cause). After: **0**.

**The baseline was not stable — that is the actual finding.** Cycle 1 first measured **15**, disputed the inherited 16, and guessed the difference was a `tsc` continuation line; the Inspector re-measured **16**. Both measurements were real. The old root config had `allowJs: true`, **no `include`**, and an `exclude` list that did not name `dist`, so `tsc` pulled the *minified renderer bundle* `app/dist/assets/index-*.js` into the program whenever one existed. Its mangled top-level name `gc` (rxdb's `HOOKS` object) collided with `@types/node`'s `declare var gc`, producing the 16th error — **so the gate's error count depended on whether anyone had run `npm run build`.** Proved causally: identical config, `dist/` present → 16 with TS2403; `dist/` moved aside → 15, no TS2403. Located with the TS compiler API (`checker.getSymbolsInScope`), which reports exactly two declarations of the global `gc`: the bundle and `@types/node/globals.d.ts:168`.

**The version-skew hypothesis is disproved.** `app/node_modules/@types/node` is 24.1.0 while `app/node_modules/electron/node_modules/@types/node` is 22.17.0, which looks like the culprit but is not: both copies declare `var gc: NodeJS.GCFunction | undefined` — *identical* types, which cannot conflict — and only the top-level copy is in the program. The skew is real but inert; no follow-up is owed for it.

Both mechanisms in the fix close this independently: `skipLibCheck` suppresses the TS2403 (it is *reported* on the `.d.ts` side), and `include: ["src", "e2e"]` keeps `dist/` out of the program entirely so it cannot recur. The `include` comment in `app/tsconfig.json` records why.

**Acceptance criteria.**
- [x] `cd app && npm run typecheck` exits 0. The script is now `tsc --noEmit && tsc -p tsconfig.node.json` — two programs, because the root-level build configs need a bundler resolution context the app's source does not.
- [x] Nothing suppressed: no `@ts-ignore`/`@ts-expect-error`/`any`-cast, and no `exclude` entry added. `skipLibCheck` covers the 15 `.d.ts` errors; the 16th (`vite.config.ts`) is fixed by *checking it properly*, in its own program, rather than by hiding it.
- [x] `app/tsconfig.json` carries a comment explaining why `skipLibCheck` is on **and** what would justify removing it (the project's own `moduleResolution`/`lib` moving forward).

**Orphaned tsconfig ruling.** Both leftover Vite-template configs were unreferenced by anything. Resolved in opposite directions, on evidence:
- **`tsconfig.node.json` — adopted.** It already described exactly the bundler context `vite.config.ts` needs, and checking it produced **0 errors**. Its `include` was widened to `vite.config.ts`, `vitest.config.ts`, `playwright.config.ts` — the three root configs the root program no longer covers — and it is now wired into the `typecheck` script. Its strict extras (`noUnusedLocals`, `verbatimModuleSyntax`, `erasableSyntaxOnly`) apply only to those three files.
- **`tsconfig.app.json` — deleted.** It duplicated the root config's job over `src` while adding those same strict extras, which cascade **28 errors across `src/`** (`erasableSyntaxOnly` on parameter properties, `verbatimModuleSyntax` on type imports, `noUnusedLocals`). Adopting it would have been a large, hard-to-unwind diff for no gate benefit; deleting it is reversible from git history.

**Gate no longer dirties the tree.** `incremental: true` + `outDir: ".erb/dll"` meant every `tsc --noEmit` rewrote `app/.erb/dll/tsconfig.tsbuildinfo` — a **tracked** build artifact. The build-info now goes to `node_modules/.tmp/` (matching the sibling configs' existing convention), the artifact is untracked, and `.erb/` is gone. Root `.gitignore` gained `*.tsbuildinfo` and `app/.erb/`.

**Also changed (cycle 1, ruled in by the user):**
- **CI runs all three gates.** `.github/workflows/ci.yml` gained a `test` job mirroring the existing two (Node 24, `npm ci` in `app/`, `cache-dependency-path: app/package-lock.json`) running `npm test`. Vitest only — Playwright e2e stays out until it has a cycle of its own (needs a built app and a display). Verified locally *with `relay/node_modules` and `service/node_modules` removed*, since CI only installs in `app/`: 553/553 green, so the cross-workspace tests in `vitest.config.ts` do resolve out of `app/node_modules`.
- **`.gitignore` brought up to date.** The three hand-listed `.claude/` scratch paths had already fallen behind the tooling (`.claude/cycles/` matched nothing), so they were replaced with `.claude/*` + `!.claude/settings.json` — which *implements* the comment that was already there instead of restating it, and needs no edit when the scratch dirs are renamed again. `.claude/settings.local.json` (machine-local permission grants) was untracked accordingly; its content is unchanged on disk.

**Known consequence:** with a test job added and the lint sweep deferred, CI shows **one red check (Lint) by design** until cycle 2 lands.

### 3 — Lint burn-down — deferred to cycle 2

Split out of cycle 1 deliberately: ~55 errors across ~28 files is a merge-conflict blast radius that collides with `receive-path-lifecycle` (owner of `file-transfer-ipc.ts`), and splitting let the CVE fix land without waiting on a long mechanical sweep. **Dispatch only after `receive-path-lifecycle` has merged to mvp.** Cycle 1 re-measured the baseline as **55 errors / 16 warnings** and left it untouched.

**Acceptance criteria.**
- [ ] `cd app && npm run lint` exits 0 (0 errors; warnings ≤ current 16, ideally 0).
- [ ] Every remaining `eslint-disable` carries a same-line justification comment.
- [ ] `npm test` green after the sweep; no runtime behavior changes (spot-check any deleted "unused" exports for dynamic use).

## Epic Acceptance Criteria (Definition of Done)

- [ ] All three gates (lint, typecheck, test) green on mvp HEAD, locally and in CI. *Cycle 1: typecheck ✅ (0 errors) and test ✅ (553/553) locally; lint ✗ (55 errors) until cycle 2. CI now **runs** all three (`test` job added) but has not been observed — first observation is when the wave-2 PR opens.*
- [ ] Review punch-list item 6 + the §2 gate-repair item checked off in [[report-260801-mvp-premerge-review]]. *Cycle 1: item 6 closed; §2 gate-repair item partially closed (typecheck half done, lint half pending).*
- [ ] Follow-up ticket filed (plan-first) for the Vitest 2→3 major bump. *Cycle 1 adds two more: rxdb's exact-pinned ws 8.18.3 (see work item 1), and `app/e2e/tsconfig.json` — a third latent orphan of the same shape as the two cycle 1 resolved. Nothing invokes it (no `references`, never passed to `tsc -p`); `e2e/` is checked under the root config's settings instead. Not a regression — behavior is unchanged from before cycle 1 — but it is the same "config file that looks authoritative but is wired to nothing" drift. Fold into cycle 2 or ticket it so it does not sit unowned.*

## Risks & Open Questions

- **Merge-conflict blast radius**: the ~28-file lint sweep will conflict with any concurrently-running lane. Hard sequencing rule: dispatch this lane **after** [[epic-ipc-trust-boundary]], [[epic-file-transfer-guards]], [[epic-handshake-stabilization]], and [[epic-session-liveness-fixes]] have merged (or restrict the sweep to files those lanes don't touch and do a second pass).
- **`skipLibCheck` trade-off**: it also skips *legitimate* lib-boundary checks; acceptable for an Electron app pinning its deps, but note it in the config comment.
- **Unused-var deletions**: some may be load-bearing (side-effect imports, IPC handler registrations held by reference). Each deletion needs a grep for dynamic references; when in doubt, disable-with-comment instead.

## References

- [[report-260801-mvp-premerge-review]] §1.6 (ws + CVE links), §2 (gate repair), §6 (dependency table incl. vitest note), §7 (gate measurements)
- Code/config: `app/tsconfig.json`, `app/vite.config.ts`, `app/eslint.config.mjs`, `app/package-lock.json`, `relay/package-lock.json`
- Related: [[epic-app-reliability-quality]] (wave-1 cross-cutting quality epic)
- Guides: [[coding-standards]] (the conventions these gates enforce)
