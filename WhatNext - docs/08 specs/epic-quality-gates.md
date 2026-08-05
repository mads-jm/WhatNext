---
tags:
  - specs/quality
  - specs/security
  - core/development
status: complete
date created: 2026-08-01
date modified: 2026-08-05
---

# Epic: Quality Gates & Dependency Hygiene

**Status**: Complete — work items 1 & 2 plus the CI test job landed 2026-08-05 (cycle 1); work item 3 (lint burn-down) landed 2026-08-05 (cycle 2). All three gates green locally. **CI green is still unobserved** — first observation is when the wave-2 PR opens.
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

**Known consequence:** with a test job added and the lint sweep deferred, CI showed **one red check (Lint) by design** until cycle 2 landed. *Resolved — see work item 3.*

### 3 — Lint burn-down — ✅ done 2026-08-05 (cycle 2)

Split out of cycle 1 deliberately: ~55 errors across ~28 files is a merge-conflict blast radius that collides with `receive-path-lifecycle` (owner of `file-transfer-ipc.ts`), and splitting let the CVE fix land without waiting on a long mechanical sweep. Dispatched after `receive-path-lifecycle` merged (mvp `413e6bf`), with cycle 1 on top at `d5b44fa`.

**Measured baseline at mvp `d5b44fa` — 55 errors / 16 warnings, confirming cycle 1's count exactly.**

| Rule | Errors | Warnings |
| --- | ---: | ---: |
| `@typescript-eslint/no-explicit-any` | 32 | — |
| `@typescript-eslint/no-unused-vars` | 16 | — |
| `prefer-const` | 2 | — |
| `react-refresh/only-export-components` | 2 | — |
| `@typescript-eslint/no-unused-expressions` | 2 | — |
| `no-control-regex` | 1 | — |
| `react-hooks/exhaustive-deps` | — | 12 |
| *(unused disable directive)* | — | 4 |
| **Total** | **55** | **16** |

Concentrations were as the brief predicted: `ipc.test.ts` 15 `any` + 4 unused args, `database.ts` 10 `any`. The one inherited number that did **not** hold is the test count — 563, not the 553 cycle 1 recorded; cycle 1 changed nothing under `app/src/`, so the difference is in how the two runs were counted, not in the suite.

**The build-state bug cycle 1 found for typecheck exists here too, and is fixed.** `globalIgnores(['dist'])` was ESLint's only project ignore, so `release/`, `playwright-report/` and `test-results/` — gitignored but not ESLint-ignored — were linted whenever they existed. Probed causally: one `.ts` file in each moved the count 55 → 58. `release/` is the sharp edge, because electron-builder vendors `node_modules` there and every `.d.ts` matches the config's `**/*.ts` block. All three are now in `globalIgnores`, with the reason in the config. Re-verified after the sweep: 0 errors / 12 warnings both with and without build artifacts present.

**Rule-option change (user ruling 1b).** `no-unused-vars` gained `argsIgnorePattern` and `caughtErrorsIgnorePattern` of `^_`, with an in-config comment recording the convention it encodes. It accounts for 4 of the 55 (`_id`/`_url`/`_cb` mock params in `ipc.test.ts`) plus one catch binding renamed to `_e`. Nothing else in the rule set moved: no severity downgrade, no directory-scoped rule-off, no new plugin or rule (rulings 1a/1c honoured).

**Fixed vs. disabled vs. deleted — the full ledger.**

*Properly typed (32 `any` → 0 written `any`):*
- `ipc.test.ts` ×15 — ruling 3, no escape hatch used. 11 were `(x as any).error/.total/.localPath` casts that existed only because each extracted handler's return type inferred as a two-branch union; annotating the handlers with the IPC result shape (success flag + optional payload/error, matching the preload-surface convention already in section 3 of that file) removed them. 2 were vestigial and needed no cast at all. 3 build `track: null` fixtures — genuine Spotify wire data that `SpotifyTrackItem` cannot express — now typed against a local `RawSpotifyTrackItem` with the widening confined to one documented function-type view. **Design smell recorded in the file:** the app-side type does not model the nullable track that `mapSpotifyTracks` exists to filter.
- `database.ts` ×10 — `oldDoc: any` was restating RxDB's own `MigrationStrategy` parameter type. Deleting the annotations lets `addCollections` supply it contextually; `strict` mode confirms they are not implicitly `any`. **Version keys untouched** (`schema-guard.yml` greps them literally).
- `dev-helpers.ts` ×2 + `DevDashboard.tsx` ×2 — `(window as any).resetRxDB` on both the producing and consuming side, so nothing connected them. Replaced with a `declare global` Window augmentation mirroring `preload.ts`'s `window.electron`.
- `Sidebar.tsx` ×1 — `NavItem.id` narrowed from `string` to `ViewId`, which every entry already satisfied; a mistyped destination is now a compile error.
- `p2p-service.ts` ×2 — `(process as any).parentPort` predates Electron's ambient types being in scope; `process.parentPort` type-checks today (verified with a probe under `strict`).

*Deleted, each proven dead first:* five `import type` specifiers (`PeerMetadata`, `ConnectionFailedPayload`, `NodeErrorPayload` in `main.ts`; `ConnectionState` in `ipc-protocol.ts`; `LogEntry` in `useP2PDevStatus.ts`; `CompanionSessionSnapshot`/`CompanionTurnState` in `useCompanionBridge.ts`) — type imports are erased, so no side effect can be lost, and `ConnectionState` was checked for re-export before removal. `handleSpotifyLink` in `ProfileSettings.tsx` — a local const, never exported, referenced nowhere in `src/` or `e2e/`, and a line-for-line duplicate of the `onAuthComplete` listener that is actually wired; **esbuild had already dropped it from the shipped bundle**, so its removal is provably invisible at runtime. `sessionName` stops being destructured in `useCompanionBridge` (it stays on the params interface; the hook has no callers).

*Justified disables, individually (3 new):*
- `main.ts` `sanitizePathSegment` — `no-control-regex`; matching C0 characters is the function's purpose, same deliberate exception as the three guards that already carry it.
- `SessionView.tsx` — unused `user` selector. This is a live re-render subscription, not dead code; deleting it changes when the component re-renders, which a lint pass is not entitled to do. Whether the subscription is wanted at all is a separate question.
- `theme-store.ts` — omit-by-rest `const { builtIn: _, ...exportable }`. The rule has an `ignoreRestSiblings` option for exactly this idiom, but ruling 1b confines option changes to the `^_` patterns, and every code rewrite that drops the binding changes emitted code for no gain. **If a future cycle revisits the rule options, this is the one site that would go away.**

**All pre-existing disables audited, not grandfathered.** The tree had 17, none justified (the brief's inherited "12" undercounted). Four were suppressing nothing and were deleted — which is why warnings fall 16 → 12. `main.ts`'s file-level `no-require-imports` disable, which covered 1400 lines to excuse two calls, was replaced by two targeted ones so future `require`s are not waved through silently. The remaining 13 gained a stated reason. On one of them the fix was actually attempted rather than assumed: `db[col]` in `useSessionReplication` does type-check, but yields a union whose `.subscribe` overloads are mutually incompatible (TS2349) — that measured result is what the comment records.

**Runtime no-op, verified against the build output, not asserted.** Building `d5b44fa` and the cycle head and diffing `dist/`: `p2p-service.mjs` and its chunks are byte-identical, `preload.js` is byte-identical, `main.js` differs by exactly one line (`catch (e)` → `catch (_e)`), and the minified renderer bundle differs by exactly one hunk (`let overallBps` → `const`). The two statement-position ternaries rewritten as if/else and the `download-disclaimer` module split produce *identical* minified output. Nothing else moved.

**Acceptance criteria.**
- [x] `cd app && npm run lint` exits 0 — **0 errors**, measured both with and without build artifacts on disk.
- [x] Warnings did not rise: **16 → 12** (the four dead directives). Zero was explicitly not required — see the follow-up below.
- [x] Every remaining `eslint-disable` in `app/src/` — 17 of them, new and pre-existing — carries an adjacent justification comment.
- [x] `npm test` green after the sweep (563/563, 40 files), `npm run typecheck` exits 0, `npm run build` exits 0, and `git status` is clean after running all of them.
- [x] No runtime behaviour change, evidenced by the `dist/` diff above rather than by inspection alone.
- [x] Commits are per-rule/per-area chunks (8 of them); each was checked out individually and independently passes `tsc --noEmit` and 563/563 tests.

## Epic Acceptance Criteria (Definition of Done)

- [x] All three gates (lint, typecheck, test) green on mvp HEAD, locally and in CI. *Locally: lint ✅ (0 errors / 12 warnings), typecheck ✅ (0 errors), test ✅ (563/563), as of cycle 2 on `d5b44fa`. **CI green remains unobserved** — CI runs all three jobs since cycle 1, but nobody has watched a run; first observation is when the wave-2 PR opens. Do not claim a run nobody saw.*
- [x] Review punch-list item 6 + the §2 gate-repair item checked off in [[report-260801-mvp-premerge-review]]. *Item 6 closed in cycle 1; the §2 gate-repair item and the §7 lint row are now fully closed by cycle 2.*
- [x] Follow-up ticket filed (plan-first) for the Vitest 2→3 major bump. *Plus three more recorded below; all plan-first, none filed on GitHub.*

## Follow-ups (plan-first — proposed in the vault, not filed)

1. **Vitest 2→3 major bump** (cycle 1).
2. **rxdb's exact-pinned `ws` 8.18.3** — needs an rxdb upgrade or an `overrides` entry (cycle 1, work item 1).
3. **`app/e2e/tsconfig.json`** — the third orphaned tsconfig; nothing invokes it, `e2e/` is checked under the root config instead (cycle 1). Deliberately **not** folded into cycle 2: it is a typecheck-config concern, not a lint one.
4. **Drive lint warnings to zero** (cycle 2, user ruling 2). All 12 remaining warnings are `react-hooks/exhaustive-deps` (2 of them the "not an array literal" variant) plus, until cycle 2 removed them, unused-directive noise. This needs its own cycle because *fixing an `exhaustive-deps` warning changes when an effect re-runs* — it is a behaviour change by construction, and therefore the exact opposite of the runtime-no-op discipline the burn-down was held to. Two distinct clusters:
   - **`react-hooks/exhaustive-deps` (12).** Concentrated in `useRxDBCollection` (4), `PlaylistView` (3), `CompanionSharePanel` (2), `useCompanionBridge` (2), `useP2PDevStatus` (1). Several are value-keyed dependency lists (`ids.join(',')`) that the rule cannot verify statically; several others would require memoising callers' props before the list can be widened safely. Each needs a per-effect decision with a live-QA check, not a sweep.
   - **`react-refresh/only-export-components`.** Zero remain — cycle 2 cleared both by moving the disclaimer's localStorage helpers into `utils/download-disclaimer.ts`, the rule's documented fix. Named here only so the follow-up's scope is unambiguous: it does **not** need to revisit this rule.
   - Also worth deciding in that cycle: whether `no-unused-vars` should gain `ignoreRestSiblings` (see the `theme-store.ts` disable above), which cycle 2 was not permitted to touch.

## Risks & Open Questions

- ~~**Merge-conflict blast radius**~~ — *resolved.* The sequencing rule held: all four named lanes had merged before cycle 2 was dispatched, and no lane was in flight alongside it. The realised surface was 29 files — 27 source modified, 1 source added (`utils/download-disclaimer.ts`), 1 config (`eslint.config.mjs`) — matching the ~28 estimate.
- **`skipLibCheck` trade-off**: it also skips *legitimate* lib-boundary checks; acceptable for an Electron app pinning its deps, but note it in the config comment.
- **Unused-var deletions**: some may be load-bearing (side-effect imports, IPC handler registrations held by reference). Each deletion needs a grep for dynamic references; when in doubt, disable-with-comment instead.

## References

- [[report-260801-mvp-premerge-review]] §1.6 (ws + CVE links), §2 (gate repair), §6 (dependency table incl. vitest note), §7 (gate measurements)
- Code/config: `app/tsconfig.json`, `app/vite.config.ts`, `app/eslint.config.mjs`, `app/package-lock.json`, `relay/package-lock.json`
- Related: [[epic-app-reliability-quality]] (wave-1 cross-cutting quality epic)
- Guides: [[coding-standards]] (the conventions these gates enforce)
