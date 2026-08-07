---
tags:
  - specs/spotify
  - integrations/spotify
  - core/net/oauth
status: shipped
date created: 2026-06-27
date modified: 2026-08-06
---

# Epic: Spotify Resilience

**Status**: Shipped — merged to `mvp` as PR #52 (2026-08-01)
**GitHub**: #44, #33
**Depends on**: none
**Source audit**: [[report-260627-mvp-state-of-the-union]] §2

> The Spotify adapter works on the happy path for a Premium account but is brittle: every non-200 response collapses into a single generic `Error`, there is no 403/Premium detection, no 429 rate-limit backoff, no retry, and no request timeout. Tokens can expire mid-flow with no graceful UX, and the OAuth PKCE / refresh / playback paths have zero integration coverage. This epic hardens the existing adapter — an error taxonomy, retry-with-backoff, timeouts, a user-facing "Premium required" degraded state, proactive token-expiry UX, and the integration tests that lock all of it in. It does **not** add or restore any endpoints; the adapter already correctly avoids the post-lockdown gutted ones (see [[the-walled-garden-cracks]]).

## Problem & Current State

The adapter lives in `app/src/main/spotify/` and is reached from the renderer via IPC handlers in `app/src/main/main.ts`. It is functional but naive:

- **One generic error path.** Both fetch wrappers throw the same shape. `spotifyFetch<T>` throws `Spotify API error {status}: {body}` at `app/src/main/spotify/spotify-client.ts:75-78`, and the raw variant `spotifyFetchRaw` repeats it at `app/src/main/spotify/spotify-client.ts:175-178` (with a `status !== 204` guard so the No-Content playback path survives). Callers cannot distinguish a 401 (reauth), a 403 (Premium-or-scope), a 404, a 429 (rate limit), or a 5xx (transient). The UI can only show "something went wrong".
- **No rate-limit handling.** Nothing reads the `Retry-After` header. A 429 throws immediately; a burst of `resolveSpotifyDisplayNames` calls (one request per unique user ID, fired in parallel — `spotify-client.ts:134-151`) is exactly the pattern Spotify rate-limits.
- **No retry, no timeout.** A single transient 5xx or a network hang fails or blocks the whole flow. `fetch` is called with no `AbortController`/timeout at `spotify-client.ts:66-73` and `:166-173`.
- **Token can expire mid-flow.** `getValidToken` (`spotify-client.ts:41-58`) already refreshes proactively when within `REFRESH_BUFFER_MS` (5 min — `app/src/shared/spotify-config.ts:35`), but a refresh failure throws a raw `Token refresh failed` and there is no UX to recover. A TODO at `app/src/main/main.ts:498` flags this: "need a UX pass on token expiry… we should proactively refresh and/or prompt the user before it becomes an interruption."
- **No degraded mode.** When playback control is unavailable (403 Premium-required), the session should keep working in metadata-only mode (`playbackProvider: 'none'`). Today the error surfaces as a failure rather than a graceful downgrade.
- **Untested auth + playback.** Mapper and IPC-handler logic are well covered in `app/src/main/__tests__/ipc.test.ts` (602 lines, Vitest), but the OAuth PKCE flow, token exchange, proactive/failed refresh, and the playback-control paths are completely untested. (The lone `403` assertion at `ipc.test.ts:417` is for **artwork download**, not the Spotify API.)

**Auth groundwork already exists — build on it, do not replace it:**
- PKCE generation, browser launch, and code exchange: `app/src/main/spotify/spotify-auth.ts` (`generatePKCE` `:19-30`, `startSpotifyAuth` `:35-61`, `handleSpotifyCallback` `:66-110`, `refreshSpotifyToken` `:115-150`).
- Encrypted token persistence via Electron `safeStorage`: `app/src/main/spotify/token-store.ts`.
- Proactive refresh buffer: `getValidToken` + `REFRESH_BUFFER_MS`.

**Endpoints in use (all allowed post-lockdown — confirmed in `spotify-client.ts`):**
- `GET /me/playlists`, `GET /playlists/{id}/tracks`, `GET /playlists/{id}?fields=…` (playlist read)
- `GET /me` (own profile), `GET /users/{id}` (public profile)
- `GET /me/player`, `GET /me/player/devices`
- `PUT /me/player/play|pause|seek`, `POST /me/player/next|previous` (playback control)

No gutted endpoints (audio-features, recommendations, audio-analysis, related-artists, etc.) are referenced anywhere. **This epic adds none.**

## Goals

- Replace the single generic throw with a typed **error taxonomy** that callers and the UI can branch on.
- Honor Spotify rate limits: detect 429, read `Retry-After`, back off, and retry.
- Add **retry with exponential backoff** for transient failures (429, 5xx, network) and a per-request **timeout**.
- Add a user-facing **"Premium required" / degraded state** so sessions continue in metadata-only mode (`playbackProvider: 'none'`) when playback control is unavailable.
- Make token expiry a non-event: proactive refresh is already there; add prompt-on-refresh-failure UX and resolve the `main.ts:498` TODO.
- Add **integration tests** for PKCE challenge/exchange, proactive refresh, refresh failure, 403/429 handling, and the 204-No-Content playback path.

## Non-Goals

- **Adding or restoring any Spotify endpoint.** Specifically not re-introducing audio-features, recommendations, or any gutted endpoint — the lockdown is permanent.
- Replacing the PKCE/refresh/token-store implementation — this epic builds on it.
- True Collaborate or Proxy Owner sync modes (separate roadmap items, Phase 2).
- Non-Spotify import adapters (Apple Music, local files, etc.).
- A general app-wide network/retry library — see [[epic-app-reliability-quality]] for cross-cutting reliability; keep Spotify changes scoped to the adapter unless a shared util is the obvious factoring.

## Proposed Approach

1. **Error taxonomy.** Introduce a `SpotifyApiError` class (or discriminated union) carrying `{ kind, status, retryAfterMs?, body }` where `kind ∈ { 'unauthorized'(401) | 'forbidden'(403) | 'not_found'(404) | 'rate_limited'(429) | 'server'(5xx) | 'network' | 'timeout' | 'unknown' }`. Both `spotifyFetch` and `spotifyFetchRaw` classify responses into this type instead of throwing strings. Preserve the existing `204` pass-through in the raw path.
2. **Retry/backoff wrapper.** Wrap the bare `fetch` calls in a single internal helper that: applies an `AbortController` timeout; retries `rate_limited`/`server`/`network`/`timeout` with exponential backoff; and for `rate_limited` waits `Retry-After` (seconds header → ms) before retrying. Bounded attempts (e.g. 3) and a max total wait. `401` triggers a single reauth-refresh attempt (reuse `getValidToken`/`refreshSpotifyToken`), never a blind retry loop. `403`/`404` do not retry.
3. **Degraded mode plumbing.** Map `forbidden` from the `/me/player/*` calls to a degraded signal the session layer reads, setting `playbackProvider: 'none'` and surfacing a "Premium required — playback disabled, session continues" UI state. Metadata (playlist read, attribution) keeps working.
4. **Token-expiry UX.** On refresh failure, emit a renderer event (mirroring the existing `spotify:auth-error` channel at `main.ts:510`) prompting reconnection rather than throwing into a flow. Resolve/remove the `main.ts:498` TODO once the prompt path lands.
5. **Tests.** Add a Vitest suite alongside `ipc.test.ts` mocking `fetch` to cover PKCE, refresh (success + failure), 403/429 classification + backoff, and the 204 playback path.

## Work Breakdown

### #44 — Robust error handling, retry/backoff, timeouts, degraded mode

**Rationale.** The adapter's failure modes are invisible to the UI and fragile under real Spotify behavior (rate limits, transient 5xx, mid-flow token expiry). A Premium-gated 403 today looks identical to a 404.

**Approach.**
- Define `SpotifyApiError` + `kind` taxonomy in the spotify module; classify in both fetch wrappers (`spotify-client.ts:75-78`, `:175-178`).
- Add an internal `fetchWithResilience` helper: timeout via `AbortController`, bounded exponential backoff, `Retry-After`-aware 429 handling, single 401→refresh→retry.
- Route playback-control `forbidden` to a degraded `playbackProvider: 'none'` state; keep metadata flows alive.
- Add refresh-failure → renderer prompt; resolve `main.ts:498` TODO.

**Acceptance criteria.**
- [ ] A typed error (kind + status + optional `retryAfterMs`) replaces the generic string throw in both `spotifyFetch` and `spotifyFetchRaw`; the `204` pass-through is preserved.
- [ ] 429 responses are retried after honoring `Retry-After`; retries are bounded and logged.
- [ ] Transient 5xx and network/timeout failures retry with exponential backoff; non-retryable kinds (403, 404) do not retry.
- [ ] Every request enforces a timeout via `AbortController`.
- [ ] A 401 mid-flow triggers exactly one refresh-and-retry; a failed refresh surfaces a reconnection prompt instead of an uncaught throw.
- [ ] A 403 on `/me/player/*` degrades the session to `playbackProvider: 'none'` with a "Premium required" UI state; playlist metadata still loads.
- [ ] The `main.ts:498` token-expiry TODO is resolved or removed.

### #33 — Integration tests for OAuth, refresh, and playback

**Rationale.** The exact paths most likely to break in the wild — auth, refresh, rate-limit handling — have zero coverage, while mappers are well tested. Tests must lock in the #44 behavior.

**Approach.**
- New Vitest suite (sibling to `ipc.test.ts`) mocking global `fetch`.
- Cover PKCE generation invariants and `handleSpotifyCallback` token exchange (success + error body).
- Cover `refreshSpotifyToken` success, refresh-token-rotation fallback (`spotify-auth.ts:141`), and failure.
- Cover proactive refresh trigger in `getValidToken` (token within `REFRESH_BUFFER_MS`).
- Cover the #44 taxonomy: 403 → forbidden/degraded, 429 → backoff honoring `Retry-After`.
- Cover the 204-No-Content playback path through `spotifyFetchRaw` / `getPlaybackState`.

**Acceptance criteria.**
- [ ] PKCE: verifier/challenge are valid base64url and challenge is the SHA-256 of the verifier; `handleSpotifyCallback` exchanges a code into tokens and surfaces error bodies on non-200.
- [ ] Refresh: success path, refresh-token rotation fallback, and failure path are each asserted.
- [ ] Proactive refresh fires when `Date.now()` is within `REFRESH_BUFFER_MS` of `expiresAt`.
- [ ] 403 and 429 responses produce the correct typed `kind`; 429 backoff honors `Retry-After`.
- [ ] `getPlaybackState` returns `null` on a 204 without attempting to parse a body.
- [ ] Suite runs green under `cd app && npm run test` (Vitest) and in CI.

## Epic Acceptance Criteria (Definition of Done)

- [ ] All non-204 non-2xx responses produce a typed error; no remaining `throw new Error('Spotify API error …')` string in `spotify-client.ts`.
- [ ] Rate-limit, transient, and timeout handling are implemented and exercised by tests.
- [ ] Degraded "Premium required" mode keeps a session functional in metadata-only mode.
- [ ] Token-expiry UX no longer interrupts a flow with a raw error; `main.ts:498` TODO closed.
- [ ] OAuth/refresh/playback integration tests exist and pass in CI.
- [ ] No new or restored Spotify endpoints were added; the endpoint set is unchanged.
- [ ] `npm run lint` and `npm run typecheck` pass; docs/index updated if new files are added.

## Risks & Open Questions

- **Rate-limit thundering herd.** `resolveSpotifyDisplayNames` fan-out (`spotify-client.ts:134-151`) may itself trigger 429s. Open question: should the resilience layer also add a concurrency cap / request queue, or is per-request backoff sufficient for MVP scale?
- **Degraded-mode contract.** Where does `playbackProvider: 'none'` live and who owns the transition — the session schema, the IPC layer, or the renderer store? Needs confirmation against the session/playback model before implementing (verify in the session schema and playback IPC handlers).
- **`Retry-After` format.** Spotify returns seconds; confirm it is never an HTTP-date in practice and decide a fallback if the header is missing on a 429.
- **Refresh-token revocation.** A revoked refresh token (user disconnected app on Spotify's side) must route to full reauth, not a retry loop — confirm the reconnection prompt covers this.
- **Backoff vs. UX latency.** Bounded retries add perceptible delay to interactive playback controls; pick conservative attempt/timeout limits for `/me/player/*` versus background polling.
- **Test isolation.** Mocking `fetch` for the auth module requires care so PKCE crypto and `safeStorage` token-store side effects stay deterministic — may need to stub `token-store`.

## Dependencies & Sequencing

- **Depends on**: none — the auth groundwork (`spotify-auth.ts`, `token-store.ts`, proactive refresh) already exists.
- **Sequencing**: Land #44 first (it defines the error taxonomy and degraded contract), then #33 to lock the behavior in. The two can overlap once the taxonomy shape is agreed, since the tests assert that shape.
- **Related**: Coordinates with [[epic-app-reliability-quality]] for any shared retry/timeout utility; keep Spotify-scoped unless a common factoring is clearly warranted.

## References

- Source audit: [[report-260627-mvp-state-of-the-union]] §2
- Concept: [[Spotify-Integration]]
- Vision / context: [[the-walled-garden-cracks]]
- Cross-cutting reliability: [[epic-app-reliability-quality]]
- Code:
  - `app/src/main/spotify/spotify-client.ts` (fetch wrappers `:63-81`, `:164-181`; playback `:191-292`; display-name fan-out `:134-151`)
  - `app/src/main/spotify/spotify-auth.ts` (PKCE, exchange, refresh)
  - `app/src/main/spotify/token-store.ts` (encrypted persistence)
  - `app/src/shared/spotify-config.ts` (scopes `:18-25`, `REFRESH_BUFFER_MS` `:35`)
  - `app/src/main/main.ts` (callback handler + token-expiry TODO `:498`)
  - `app/src/main/__tests__/ipc.test.ts` (existing mapper/handler coverage, Vitest)
- GitHub: #44 (error handling), #33 (integration tests)
