---
tags:
  - architecture/review
  - core/development
---

# Dead Code Audit — 2026-03-22

## Files to Delete

| File | Reason |
|------|--------|
| `app/src/renderer/hooks/useCompanionBridge.ts` | Never imported — companion system is wired in main/preload but this renderer hook is orphaned |
| `app/src/renderer/services/turn-service.ts` | Never imported — turn logic lives directly in `playlist-service.ts` |

## Unused Exports to Remove

### `app/src/renderer/db/services/track-service.ts`
- `getTrack()` — defined but never called
- `getAllTracks()` — defined but never called
- `searchTracks()` — defined but never called

### `app/src/renderer/db/services/playlist-service.ts`
- `getAllPlaylists()` — defined but never called
- `searchPlaylists()` — defined but never called
- `clearPlaylist()` — defined but never called

### `app/src/shared/core/types.ts`
- `DetailedPeerInfo` interface — never imported
- `P2PMessage<T>` interface — never imported
- `HandshakePayload` interface — never imported
- `PresencePayload` interface — never imported
- `DataTestPayload` interface — never imported
- `FileTransferMetadata` interface — never imported
- `P2PMessageType.PRESENCE` enum variant — never referenced
- `P2PMessageType.DATA_TEST` enum variant — never referenced
- `P2PMessageType.FILE_TRANSFER` enum variant — never referenced

### `app/src/main/utils/path.ts`
- `resolveHtmlPath()` — never called (only `getAssetPath` is used)

### `app/src/shared/core/ipc-protocol.ts`
- `P2P_ACCEPT_CONNECTION` channel — defined but never handled or sent
- `P2P_REJECT_CONNECTION` channel — defined but never handled or sent
- `P2P_PEER_LOST` channel — defined but never sent via IPC
- `P2P_NODE_STOPPED` channel — defined but never used

## Unused CSS

### `app/src/styles/main.css`
- `@utility btn-accent` — defined but never used in any component

## Unused npm Dependencies

### `app/package.json`
- `simple-peer` — zero imports across all source files; WebRTC handled by `@libp2p/webrtc`
- `webrtc-adapter` — zero imports across all source files

## Notes

- `app/src/renderer/db/dev-helpers.ts` attaches `window.resetRxDB` / `window.nukeRxDB` — imported as side-effect in `database.ts`. Intentional dev tooling, not dead code.
- `app/src/styles/fonts.css` is deleted in git but no references remain — migration to `main.css` Google Font imports is complete.
- [[Companion-Client|Companion server]] (`app/src/main/companion/`) is wired into main.ts and preload.ts — it's live code, only the **renderer hook** (`useCompanionBridge.ts`) is orphaned.
