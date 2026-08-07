---
tags:
  - pr
  - core/net/p2p
  - dev-env
  - mvp
pr: 35
title: "feat(p2p): add protocol handlers and session validation to test peer"
date merged: 2026-03-15
base: mvp
head: claude/test-peer-client-playlist-rLa0a
merge commit: d2d006e
author: mads-jm
reviewers:
  - mads-jm
review-result: self-merged
---

# PR #35 — feat(p2p): add protocol handlers and session validation to test peer

**Merged:** 2026-03-15 · **Base:** `mvp` ← **Head:** `claude/test-peer-client-playlist-rLa0a` · **Merge commit:** `d2d006e`

## What merged

Upgraded `/test-peer` from a bare connection probe to a full protocol participant: JS ports of the handshake and replication handlers (registering `/whatnext/handshake/1.0.0` and `/whatnext/rxdb-replication/1.0.0` with pull-response support), an in-memory session store with LWW conflict resolution and document factories, and seven new interactive CLI commands (`pull`, `track-add`, `playlist`, `tracks`, `peers-info`, `vote`, `session`).

## Why

End-to-end validation of playlist replication needed a second peer that speaks the real wire protocols without spinning up a second Electron app. This made [[pr-34-remote-session-pairing|PR #34]]'s replication path testable interactively from a terminal.

## Scope & files

3 files, all in `test-peer/src` (`index.js`, `protocols.js`, `session-store.js`).

## Review

Agent-authored branch (Claude Code, `claude/` prefix); merged by mads-jm without a formal external review at the time. The mvp line was later independently reviewed in [[report-260801-mvp-premerge-review]].

## References

- Companion: [[pr-34-remote-session-pairing]]
