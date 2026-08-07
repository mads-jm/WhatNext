---
tags:
  - report
  - debt
date created: 2026-08-06
status: active
---

# Tech-Debt Inventory — v0.1.0 Pre-Merge (2026-08-06)

#report/debt

Workstream 4 of the v0.1.0 pre-merge touch-up. Consolidates every debt item carried out of the wave-1/wave-2 cycles, the two pre-merge reviews, and a fresh repo-wide sweep at `mvp` HEAD `ceb4ebd`. Sweep coverage: TODO markers, deprecated APIs, dependency staleness, config debt, error handling, type debt, duplication/dead code, store rot, scripts health, and the service skeleton.

GitHub writes were plan-first per project policy; the §5 proposals have since been **filed as issues #67–#79 (2026-08-06, after user sign-off)** — §5 records the filings and their numbers.

---

## 1. Genuine bugs found by the sweep (not just debt)

These are defects, discovered 2026-08-06 while inventorying. None are fixed yet.

| ID | Defect | Evidence | Severity |
|----|--------|----------|----------|
| B1 | **Packaged builds cannot boot** — production branch loads `index.ejs`, deleted in the ERB→Vite migration (`ee6a9d2`); Vite emits `dist/index.html`. Only dev mode has ever been exercised; CI has no packaging job to catch it. | `main.ts:110`; zero `*.ejs` in repo | **HIGH — ship-blocking** |
| B2 | `scripts/start-service.mjs` passes a port argument the server never reads (`server.ts` hardcodes 3001; script advertises 4200) | `start-service.mjs:12,14` vs `server.ts:5` | MEDIUM |
| B3 | **P2P scope-gate CI workflow watches paths that no longer exist** (`app/src/main/p2p/**`, `app/src/main/handshake.ts`). The real protocol lives in `app/src/utility/` — none of it triggers the gate. The CLAUDE.md P2P governance rule is unenforced for the files it was written to protect. | `p2p-gate.yml:7-10` | **HIGH — dead governance control** |
| B4 | **Schema-migration guard verifies a comment, not a migration** — greps `N:` which matches only the doc comments; real migrations use shorthand `N(oldDoc) {`. Also collapses versions across all five collections (`sort -u`), hiding per-collection bumps. | `schema-guard.yml:45,30-33`; `database.ts:137-183` | MEDIUM-HIGH |
| B5 | **Protocol-constant registry drift is already real**: `p2p-config.ts` `PROTOCOLS` lacks `FILE_TRANSFER` (it lives separately in `file-transfer-types.ts:26`), while test-peer's mirror — which declares the incomplete file its "source of truth" — has all four. Numeric values still match (verified). No parity test. | `p2p-config.ts:53-57`; `test-peer/src/p2p-config.js:30-34` | MEDIUM |
| B6 | Handshake advertises hardcoded version `0.1.0` while `app/package.json` says `0.0.1`; semantic-release bumps neither. Three sources, all diverging. | `p2p-config.ts:108`; `test-peer/src/p2p-config.js:57` | LOW-MEDIUM |

## 2. Known open defects (already filed)

#43 turn-advance concurrent-add race (geography mapped in `turn-service.test.ts` #43 pins) · #49 no React error boundaries/StrictMode · #57-family downloader truthfulness remnants → #63 batch stranding, #64 spotDL output drift · #59 isLocal identity adoption · #60 ParticipantRoster co-host ring · #62 renderer `file://` fetch · #65 file-transfer stream-opening design question · #67 searchPlaylists unescaped `$regex` · #68 mutators return stale pre-update RxDocument snapshots (`resolveSpotifyUser` priority) · #69 `createPlaylist` drops `maxDurationMs`.

## 3. Debt by category

### 3.1 Architecture & boundaries

- **`app/` imports `service/` source across package boundaries — 10 files, no dependency edge.** Runtime imports of `killAll` twice at different relative depths (`main.ts:56`, `downloader-ipc.ts:23`); type imports from 6 renderer/preload files; `vite.config.ts` carries `server.fs.allow: ['..']` to permit it. Consequences: service source typechecked under two conflicting configs, tsup silently bundles it, refactors break the app with no signal. Needs a boundary decision (workspace / published package / absorb `downloader/` into app). **HIGH.**
- **`test-peer/` is a second, untyped, untested P2P protocol implementation** — 3,323 lines of plain JS, `protocols.js` self-describes as hand-synced ports of `handshake.ts`/`replication.ts`. No parity test, no typecheck; B5 shows drift has begun. Standing policy says protocol changes bring test-peer along in the same cycle — nothing verifies compliance. **HIGH.**
- **`companion-web/` duplicated verbatim ×2** (994 lines each, app + relay copies). Mitigated by the sha256 parity test, but every fix is applied by hand twice — the mitigation is a test, not a build step. LOW.
- Quadruplicated turn-order derivation: `turn-helpers.resolvedTurnOrder` (honors `playlist.turnOrder`), `turn-service.getTurnOrder` (ignores it), `playlist-service.advanceTurn`, `TurnManagementPanel` inline divergent copy. Consolidation is provably behavior-changing → belongs to #43's fix, not an org pass. MEDIUM.

### 3.2 God objects / file size

| File | Lines | State slots | Notes |
|------|-------|-------------|-------|
| `main/file-transfer/file-transfer-ipc.ts` | 1,467 | 18 module-level mutable | **Largest file in repo; not previously on the ledger** |
| `utility/p2p-service.ts` | 1,331 | 12 private fields | Two ~500-line methods; has a test seam + 21 pins now |
| `test-peer/src/index.js` | 1,526 | — | Untyped, untested |
| `main/companion/companion-server.ts` | 1,139 | 16 module-level | |
| `main/main.ts` | 1,082 | — | Post-org-pass residue: dialogs, P2P relay wiring, relay config, media import |
| `main/preload.ts` | 951 | — | Contract surface — split carefully or not at all |
| `shared/core/ipc-protocol.ts` | 639 | — | Contract surface |
| `renderer/db/schemas.ts` | 603 | — | Schema-guard-watched |

Renderer components: `PlaylistView` 650, `TurnManagementPanel` 527, `SessionSetup` 507, `DownloadSettings` 481, `SessionView` 480, `LibraryView` 444. Settings panels repeat a card/header/button Tailwind idiom with no shared `<SettingsCard>` primitive. LOW-MEDIUM.

### 3.3 Error handling & observability

- **No `unhandledRejection`/`uncaughtException` handler in any process.** Worst for the utility process (`p2p-service.ts` under `utilityProcess.fork`): one un-awaited dial rejection kills P2P silently; main learns only via `exit`. Same exposure for `relay-server.mjs`. **HIGH.**
- Error-swallowing `.then(() => {})` ×2 in the byte-duplicated artwork block (`useSpotifySync.ts:169`, `useSpotifyImport.ts:334`). MEDIUM.
- Floating promises with no `.catch` in render effects: `SessionView.tsx:78,102,139,187`, `PlaylistView.tsx:444`, `SessionSetup.tsx:156,167` — compounding #49 (no error boundaries). MEDIUM.
- `database.ts:249` unconditional floating `import('./dev-helpers')` (assignments inside are dev-guarded — verified — but the module ships in prod bundles and a failed import rejects silently); `destroyDatabase()` wipes data yet is named/documented as cleanup; five unguarded `.count()` stat queries on every init. MEDIUM/LOW.
- Console-driven observability: 194 `console.*` sites, no logger, no levels, no redaction — and console is the utility process's only diagnostic channel. MEDIUM.
- Negative finding: zero empty `catch {}` across all 41 catch sites; zero `@ts-ignore`/`@ts-expect-error` in source.

### 3.4 Security posture residuals

- `webPreferences` lacks `sandbox: true`; no `will-navigate` guard (window-open is handled twice, navigation not at all). MEDIUM.
- `resolveArtworkPath` lacks realpath (symlink inside artwork root would serve; not renderer-reachable today). On record since the 260804 review. LOW.
- Backend path validated at set-time, not spawn-time. On record. LOW.
- Accepted risks (rulings on record, tripwires documented): PIN+token in join frame (domination argument); fail-closed file serving after host restart; served-hash registry semantics. Not debt — listed to keep them visible.
- service WS skeleton broadcasts every message to every client, no auth/origin/validation — fine as a stub, dangerous the day it deploys. MEDIUM (design).

### 3.5 Dependencies

- **Electron 37.10.3 vs 43.3.0 — six majors behind, outside the 3-major security-support window. The single biggest dependency risk in the repo.** HIGH.
- libp2p stack resolved to three different versions across app/relay/test-peer despite identical ranges (3.1.0 / 3.1.6 / 3.1.0; circuit-relay 4.1.0 vs 4.1.6) — peers in one handshake run different builds. MEDIUM.
- Vitest gap is 2→4 (not 2→3 as previously recorded); relay/service pin `^2.1.9` vs app `^2.0.0`. MEDIUM.
- Other majors behind (app): typescript ×2, jsdom ×5, uuid ×3, eslint ×1, rxdb ×1, vite ×1, @vitejs/plugin-react ×2, cross-env ×3. rxdb still exact-pins ws 8.18.3 on a dead path (overrides entry available). MEDIUM/LOW.
- Dead deps: `@tailwindcss/postcss` (nothing references it), `nodemon` in service. LOW.
- actions/checkout@v4 + setup-node@v4 target deprecated Node 20 (CI warning on every run). LOW.

### 3.6 Config & tooling

- `app/tsconfig.json` is still ERB-shaped: `outDir: .erb/dll`, excludes for nonexistent dirs, unresolvable `@models/*` alias, `allowJs` with zero first-party JS. MEDIUM.
- Strictness inversion: `tsconfig.node.json` (3 build files) enables `noUnusedLocals`/`noUnusedParameters`/etc.; `tsconfig.json` (all of `src/`) enables none. MEDIUM.
- `vitest.config.ts` include misses `.test.tsx` — a first component test written as `.tsx` collects zero tests and CI stays green. MEDIUM (latent trap).
- Four inconsistent Node baselines: engines `>=20.19.0`, CI `24`, tsup `--target node18` ×6, dev-init pins `v24.3.0`. MEDIUM.
- Dead Tailwind v3 config + no-op postcss/autoprefixer chain (`browserslist: []`). LOW-MEDIUM.
- No `.gitattributes` (the format cycle's 159-file CRLF→LF conversion recurs risk on a synced drive); no `.git-blame-ignore-revs` (Governor ruling pending). MEDIUM.
- eslint version skew across workspaces; dead prettier `overrides` block in root config. LOW.
- Committed junk: `app/2025-11-09-init.txt` — a tracked AI terminal transcript. MEDIUM (hygiene).
- `app/e2e/tsconfig.json` orphan. LOW.

### 3.7 Dead code

- **`app/src/main/menu.ts` — 321 lines, imported by nothing** (app sets `Menu.setApplicationMenu(null)`, `frame: false`); also carries the deprecated macOS `selector:` API. Largest dead block known; was not in the 260322 audit. MEDIUM-HIGH.
- Dead exports (0 references, verified): `resolveHtmlPath` (`main/utils/path.ts:9` — ironically the helper that would have prevented B1, and itself broken), `isTest`, `P2PConfig`, `ProtocolName` (whose existence justifies keeping deprecated `RETRY_INTERVAL`), `file-transfer-store.removeTransfer`, `clearPlaylistTransfers`. LOW each.
- Remaining `dead-code-audit-260322` entries unverified since March. **Warning: `turn-service.ts` is no longer safe to delete blind — it has a test suite as of `cbd2518`.** `useCompanionBridge` already deleted (`ad6a117`, recovery ref in commit body).

### 3.8 Testing

- Store coverage inverted: only `navigation-store` (the thinnest) is tested; `theme-store` (142 lines, most logic), `file-transfer-store` (91, incl. unchecked `as ActiveTransfer` insert on cache miss), `user-store` untested. MEDIUM.
- `service/src/server.ts` is the only source file in its package with no test (vitest include covers `downloader/` only). MEDIUM.
- File-transfer suites order-dependent under `--sequence.shuffle` (sequential fixtures by design; predates reorg). LOW.
- db test harness hand-duplicates `database.ts` plugin registration (docblock mitigation only). MEDIUM.
- `protocols/ping.ts` untested. LOW.
- E2E: 16-file Playwright POM + 7 skipped smoke specs parked for the post-v0.1.0 POM effort (#48).
- 10 deferred `exhaustive-deps` lint warnings (ruling on record; ceiling enforced).

### 3.9 Scripts & service skeleton

- `proj-init.sh` fully rotted (bootstraps a project that no longer resembles this repo). `dev-init.sh` installs 2 of 4 workspaces and pins Node v24.3.0 against engines `>=20.19.0`. `start-dev.mjs` never starts the relay and swallows child exit codes. `start-app.mjs` accurate. MEDIUM.
- `service/package.json` is npm-init boilerplate: `main` points at a nonexistent file, runtime deps in devDependencies, no start/dev script, empty metadata — and **no LICENSE file exists anywhere in the repo**. MEDIUM.
- `service/README.md` describes the 33-line skeleton and never mentions the downloader (the package's actual payload). `server.ts` byte-equivalent to its bootstrap heredoc. MEDIUM.
- TODO markers: 9 total repo-wide (list in sweep archive); notable: protocol-URL routing boundary (`main.ts:476`), Spotify pagination question (`spotify-ipc.ts:220`), empty peer multiaddrs (`p2p-service.ts:969`). LOW-MEDIUM.

### 3.10 Type debt

- The only true `any` in source: `(db as any)[col]` ×2 in `useSessionReplication.ts:72,183` — fixable with a keyof-indexed type. MEDIUM.
- Five identical `stream as unknown as AsyncIterable` casts across three protocol files (libp2p typing gap, no shared helper); six `as unknown as` RxDB doc↔plain-object boundary casts. LOW-MEDIUM.

## 4. Cross-cutting reading

Three themes explain most of the list:

1. **The ERB→Vite migration was never finished.** B1, `resolveHtmlPath`, `menu.ts`, `tsconfig` residue, `.erb/` ignore entries, dead Tailwind/postcss chain — one family, one archaeology session to close.
2. **Package boundaries were never drawn.** app↔service imports, test-peer's hand-synced protocol stack, companion-web ×2, three drifting lockfiles for one libp2p protocol — the repo behaves like a monorepo without monorepo tooling.
3. **The guards outrank the gates.** Two CI safety workflows (p2p-gate, schema-guard) are silently broken while the ordinary gates (lint/typecheck/test/format) are healthy — enforcement debt is invisible precisely because nothing red appears.

## 5. Proposed GitHub issues — **all filed 2026-08-06 after user sign-off**

| Issue | Title | Covers |
|-------|-------|--------|
| #70 | fix(ui): packaged build loads deleted index.ejs — production boot broken | B1 (+ delete `resolveHtmlPath`, `menu.ts` in same lane) |
| #71 | ci: p2p-gate watches nonexistent paths — governance rule unenforced | B3 |
| #72 | ci: schema-guard verifies comments, not migrations; collapses versions across collections | B4 |
| #73 | fix(p2p): no unhandledRejection/uncaughtException handlers in any process | §3.3 |
| #76 | build(deps): Electron 37→43 — out of security support (post-merge by design) | §3.5 |
| #74 | refactor: decide the app↔service boundary (workspace, package, or absorb) | §3.1, §3.9/§10 |
| #75 | test(p2p): protocol-constant parity app↔test-peer + complete PROTOCOLS registry | B5 |
| #77 | fix(dev-env): scripts drift — service port, dev-init 2/4 workspaces, proj-init rotted | B2, §3.9 |
| #78 | chore(dev-env): finish the ERB→Vite migration cleanup | §3.6, §3.7 |
| #79 | fix(p2p): handshake advertises hardcoded 0.1.0 while app is 0.0.1 | B6 |

Items deliberately **not** filed: everything already on the board (#43…#69), accepted-risk rulings, the god-object splits (future org passes — this inventory is their record), and dependency minors.

## 6. Relation to the mvp→main merge

Merge-gating subset per user ruling 2026-08-06: **#70** (the app must boot packaged), **#71/#72** (broken safety gates do not cross into main unfixed), and the live-QA pass already planned. Everything else is post-merge backlog.

---

*Sweep archive (full evidence, file:line for every claim): session task output, 2026-08-06. Related: [[report-260801-mvp-premerge-review]], [[report-260804-ipc-trust-boundary-review]], [[epic-quality-gates]], [[dead-code-audit-260322]].*
