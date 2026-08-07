---
tags:
  - pr
  - dev-env
  - mvp
  - wave-1
pr: 55
title: "chore: rename eslint flat config to .mjs so it loads"
date merged: 2026-08-02
base: mvp
head: chore/fix-dev-env-lint
merge commit: 1437c50
author: mads-jm
reviewers:
  - mads-jm
review-result: APPROVE
---

# PR #55 — chore: rename eslint flat config to .mjs so it loads

**Merged:** 2026-08-02 · **Base:** `mvp` ← **Head:** `chore/fix-dev-env-lint` · **Merge commit:** `1437c50`

## What merged

A single `git mv app/eslint.config.js app/eslint.config.mjs` — 100% rename, zero content change, no rules touched. The flat config is ESM but `app/package.json` declares `"type": "commonjs"`, so Node parsed the config as CJS and ESLint aborted with a `SyntaxError` before lint ever ran. The `.mjs` extension forces ESM and ESLint auto-discovers it, so no script or CI changes were needed.

## Why

All four wave-1 lanes independently hit the broken config — none could run `npm run lint` for real. After the fix, lint runs to completion and surfaced 22 pre-existing problems, intentionally left for a follow-up cleanup (later burned down to zero in the quality-gates epic).

## Scope & files

1 file: `app/eslint.config.mjs`. No issue number (infra-only). Merged first of the wave-1 batch so the lanes behind it could lint.

## Review

Wave-1 support fix alongside the four inspected lanes (AI-assisted review; verdicts archived locally); merged by mads-jm. Independent pre-merge review of the integrated wave in [[report-260801-mvp-premerge-review]]. Branch was re-rooted onto the mvp checkpoint and re-verified as a pure rename before merge.

## References

- Follow-up: lint burndown in [[epic-quality-gates]]
