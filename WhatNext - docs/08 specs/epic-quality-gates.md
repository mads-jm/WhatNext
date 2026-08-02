---
tags:
  - specs/quality
  - specs/security
  - core/development
status: draft
date created: 2026-08-01
date modified: 2026-08-01
---

# Epic: Quality Gates & Dependency Hygiene

**Status**: Draft
**GitHub**: to be filed (plan-first)
**Depends on**: none — but **sequence last** among the wave-2 lanes (lint burn-down touches many files; running it concurrently with other lanes invites conflicts)
**Source audit**: [[report-260801-mvp-premerge-review]] §1.6, §2 (gate repair), §7

> Two of the repo's three quality gates are red for reasons that have nothing to do with the code: typecheck fails on environmental noise (zero source errors) and lint — which only *runs* at all since the wave-1 config fix — reports 59 pre-existing errors. A permanently-red gate is worse than no gate: it trains everyone to ignore red, which is how real regressions ship. Separately, the `ws` WebSocket library is locked below the CVE-2026-45736 fix in both network-listening workspaces (merge-blocker #6). This epic makes all three gates green-and-meaningful and clears the dependency advisory.

## Problem & Current State

Verified on the integrated tree (now mvp `cafc6ab`) 2026-08-01:

1. **`ws` below CVE fix (blocking, trivial)** — `app/package-lock.json` resolves ws **8.19.0**, `relay/package-lock.json` **8.20.0**; CVE-2026-45736 (information disclosure) is fixed in **8.20.1**. Both ranges (`^8.19.0`/`^8.20.0`) already allow the fix — this is purely a lockfile refresh. The companion server and relay tunnel are network-listening consumers.
2. **Typecheck red, 100% environmental** — `cd app && npm run typecheck`: every error is `node_modules` `.d.ts` resolution noise or `vite.config.ts` under the current `moduleResolution`; zero source errors. Review direction: `"skipLibCheck": true` plus `moduleResolution: "bundler"` for the vite-config context.
3. **Lint: 59 errors / 16 warnings** across ~28 files — mostly `no-explicit-any` and unused vars. Pre-existing debt revealed (not created) by the wave-1 config fix.
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

### 1 — `ws` CVE bump (review §1.6, punch-list item 6)

**Acceptance criteria.**
- [ ] `app` and `relay` lockfiles resolve `ws` ≥ 8.20.1.
- [ ] App test suite green; relay starts and accepts a connection (manual or scripted smoke).

### 2 — Typecheck gate repair

**Acceptance criteria.**
- [ ] `cd app && npm run typecheck` exits 0.
- [ ] No `@ts-ignore`/`@ts-expect-error`/`any`-cast added to *source* to get there; only config-level environmental fixes (`skipLibCheck`, vite-config module resolution).
- [ ] A one-line note in the config explains *why* `skipLibCheck` is on (environmental `.d.ts` noise), so it isn't cargo-culted away later.

### 3 — Lint burn-down

**Acceptance criteria.**
- [ ] `cd app && npm run lint` exits 0 (0 errors; warnings ≤ current 16, ideally 0).
- [ ] Every remaining `eslint-disable` carries a same-line justification comment.
- [ ] `npm test` green after the sweep; no runtime behavior changes (spot-check any deleted "unused" exports for dynamic use).

## Epic Acceptance Criteria (Definition of Done)

- [ ] All three gates (lint, typecheck, test) green on mvp HEAD, locally and in CI.
- [ ] Review punch-list item 6 + the §2 gate-repair item checked off in [[report-260801-mvp-premerge-review]].
- [ ] Follow-up ticket filed (plan-first) for the Vitest 2→3 major bump.

## Risks & Open Questions

- **Merge-conflict blast radius**: the ~28-file lint sweep will conflict with any concurrently-running lane. Hard sequencing rule: dispatch this lane **after** [[epic-ipc-trust-boundary]], [[epic-file-transfer-guards]], [[epic-handshake-stabilization]], and [[epic-session-liveness-fixes]] have merged (or restrict the sweep to files those lanes don't touch and do a second pass).
- **`skipLibCheck` trade-off**: it also skips *legitimate* lib-boundary checks; acceptable for an Electron app pinning its deps, but note it in the config comment.
- **Unused-var deletions**: some may be load-bearing (side-effect imports, IPC handler registrations held by reference). Each deletion needs a grep for dynamic references; when in doubt, disable-with-comment instead.

## References

- [[report-260801-mvp-premerge-review]] §1.6 (ws + CVE links), §2 (gate repair), §6 (dependency table incl. vitest note), §7 (gate measurements)
- Code/config: `app/tsconfig.json`, `app/vite.config.ts`, `app/eslint.config.mjs`, `app/package-lock.json`, `relay/package-lock.json`
- Related: [[epic-app-reliability-quality]] (wave-1 cross-cutting quality epic)
- Guides: [[coding-standards]] (the conventions these gates enforce)
