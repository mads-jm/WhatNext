---
tags:
  - pr
  - core/net/p2p
  - sessions
  - mvp
pr: 34
title: "feat(p2p): remote session pairing — relay, replication, co-host model"
date merged: 2026-03-15
base: mvp
head: claude/plan-p2p-pairing-GXM4F
merge commit: 0455ce6
author: mads-jm
reviewers:
  - mads-jm
review-result: self-merged
---

# PR #34 — feat(p2p): remote session pairing — relay, replication, co-host model

**Merged:** 2026-03-15 · **Base:** `mvp` ← **Head:** `claude/plan-p2p-pairing-GXM4F` · **Merge commit:** `0455ce6`

## What merged

The foundational remote-P2P milestone trio for MVP 0.1.0. M1 delivered user-configured [[Circuit-Relay|circuit relay]] pairing: persistent relay peer ID, DCUtR direct-connection upgrade, `whtnxt://` invite URLs with short codes, and the relay-management/share-session UI. M2 wired [[RxDB-Replication|RxDB replication]] into sessions via a `useSessionReplication` hook (change-stream push, incoming-change apply, correlation-ID pull bridge between renderer and utility process). M3 added the co-host model and playback mutex: `coHostIds` on the playlist schema (v5 migration), `playbackOwnerId` on session state, and ownership-gated playback controls. Also fixed pre-existing libp2p v2 Stream API type errors across handshake, replication, and ping protocols.

## Why

Remote pairing is the product: without relay-mediated NAT traversal, sessions only worked over mDNS on one LAN. This PR made the coordinator-model session shareable across the internet with no central server for the collaboration itself.

## Scope & files

35 files — `app/src` (22: p2p service, protocols, IPC surface, hooks, session UI, schema v5 migration), `relay/relay-server.mjs` (persistent ed25519 key), plus vault docs (ADR, spec, concept pages).

## Review

Agent-authored branch (Claude Code, `claude/` prefix); merged by mads-jm without a formal external review at the time. The full mvp line including this work was later independently reviewed pre-merge in [[report-260801-mvp-premerge-review]].

## References

- Spec: [[p2p-session-pairing-spec]]
- Companion: [[pr-35-test-peer-protocols]]
