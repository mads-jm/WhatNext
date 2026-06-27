---
kanban-plugin: board
date created: Tuesday, April 7th 2026, 3:16:24 am
date modified: 2026-06-27
---

# BACKLOG.kanban

> Synced to GitHub 2026-06-27 — see [[report-260627-issue-reconciliation]]. ⚠️ = touches P2P protocol → needs human approval (CLAUDE.md / `needs-p2p-review` label).

## Inbox

- [ ] **#40** fix(p2p): persist replication checkpoints (no per-launch resync) ⚠️
- [ ] **#41** fix(p2p): replication timeout/backoff + reconnection ⚠️
- [ ] **#42** fix(p2p): LWW timestamp parsing (replace string compare) ⚠️
- [ ] **#43** fix(sessions): turn-advance coordination (race on concurrent adds)
- [ ] **#44** fix(spotify): 403/429 handling, retry/backoff, token-expiry UX
- [ ] **#45** test(downloader): backend-execution integration tests
- [ ] **#46** feat(downloader): binary bundling / custom-path config
- [ ] **#47** fix(p2p): harden + test P2P fileshare v0 ⚠️
- [ ] **#32** test(p2p): replication/handshake/turn tests ⚠️
- [ ] **#33** test(spotify): OAuth + playback integration tests
- [ ] **#26** test(db): service-layer CRUD tests
- [ ] **#48** test: critical-flow E2E (import, session, turn)
- [ ] **#49** fix(ui): React error boundaries
- [ ] **#50** refactor(ui): extract useSessionData, thin SessionView

## Scoping

- [ ] **#22** produce + smoke-test electron-builder installers per platform

## Ready

- [ ] **#36** feat(sessions): playback mutex (enforce playbackOwnerId + handoff UI) ⚠️
- [ ] **#37** feat(sessions): un-stub Manual TrackSource (`useTrackSource.ts:322`)
- [ ] **#38** feat(p2p): un-stub P2P TrackSource (depends on #40–#42) ⚠️
- [ ] **#39** feat(sessions): companion bidirectional control (phone→host)

## In Progress

## In Review

## Done

- [x] **Foundation** #1–6: Electron init, UI shell, IPC, RxDB + schemas, CRUD
- [x] **Spotify** #12–15, #19: OAuth PKCE, playlist fetch/sync, playback controls, accessory-mode UI
- [x] **Sessions + social** #16–18: session UI, peer display, turn-taking UI
- [x] **P2P foundation** #27, #28, #30, #31: libp2p PoC + integration, NAT/relay, RxDB replication
- [x] **Protocol** #10: `whtnxt://` join (full-link; short-code deferred to Phase 2)
- [x] **DevOps** #20, #21: CI/CD pipeline, Vitest framework
- [x] **#29 WONT-FIX**: Kademlia DHT — chose mDNS + circuit relay ([[adr-260315-p2p-session-pairing]])

%% kanban:settings

```ts
{"kanban-plugin":"board","list-collapse":[false,false,false,false,false,false]}
```

%%
