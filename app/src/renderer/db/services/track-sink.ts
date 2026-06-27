/**
 * Track Sink — source-agnostic normalize→write path.
 *
 * The single tail that every `TrackSource` arm funnels through: it takes an
 * `IncomingTrack` (the lean, pre-normalization shape any adapter emits),
 * persists it as a `TrackDocType` attributed to `addedBy`, and adds it to the
 * target session playlist. A manual entry, a library pick, and (later) a
 * replicated P2P insert are therefore indistinguishable downstream — same
 * `TrackDocType`, same feed render, same turn accounting.
 *
 * Turn advancement is intentionally NOT triggered here. The track is appended
 * via `bulkAddTracksToPlaylist` (which does not mutate turn counters), mirroring
 * the Spotify arm (`useTrackSource` → `processIncomingTracks`). The UI derives
 * the current turn from each track's `addedBy` via `computeEffectiveTurn`
 * (turn-helpers), so a single add advances the turn exactly once and we avoid
 * the `advanceTurn()` double-fire race flagged in the epic. See
 * `.claude/cycle/impl-notes.md`.
 */

import type { IncomingTrack } from '../../../shared/session-interfaces';
import type { CreateTrackInput } from '../types';
import { createTrack } from './track-service';
import { bulkAddTracksToPlaylist } from './playlist-service';

export interface AddIncomingTrackResult {
    /** ID of the freshly-created TrackDocType. */
    trackId: string;
}

/**
 * Normalize an `IncomingTrack` to a `TrackDocType`, persist it attributed to
 * `addedBy`, and append it to `playlistId`.
 *
 * A fresh track doc is minted on every call (even for library-backed picks) so
 * the track is attributed to the session participant who added it — turn
 * accounting derives the current turn from each track's `addedBy`.
 */
export async function addIncomingTrack(
    incoming: IncomingTrack,
    playlistId: string,
    addedBy: string
): Promise<AddIncomingTrackResult> {
    // Spotify is the only source whose externalId maps onto spotifyId.
    const isSpotify = incoming.externalSource === 'spotify';

    const input: CreateTrackInput = {
        title: incoming.title,
        artists: incoming.artists,
        album: incoming.album,
        durationMs: incoming.durationMs,
        albumArtUrl: incoming.albumArtUrl,
        addedBy,
        addedAt: incoming.addedAt,
        source: incoming.externalSource,
        spotifyId: isSpotify ? incoming.externalId : undefined,
        localFilePath: incoming.localFilePath,
    };

    const track = await createTrack(input);
    await bulkAddTracksToPlaylist(playlistId, [track.id]);

    return { trackId: track.id };
}
