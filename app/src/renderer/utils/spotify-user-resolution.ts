/**
 * Spotify User Resolution
 * Maps Spotify user IDs to WhatNext user IDs, creating stubs for unknown users.
 * Pure async function — no React, no IPC, no window access.
 */

interface TrackWithSpotifyUser {
    addedBySpotifyId: string;
    addedByDisplayName?: string;
}

/**
 * Resolve a batch of Spotify user IDs to WhatNext user IDs.
 * Creates stub participant profiles for any Spotify user not yet in the database.
 *
 * @param tracks - Tracks containing Spotify user attribution
 * @param findBySpotifyId - Looks up existing WhatNext user by Spotify ID
 * @param createStub - Creates a new participant stub and returns its ID
 * @returns Map from Spotify user ID → WhatNext user ID
 */
export async function resolveSpotifyUsers(
    tracks: TrackWithSpotifyUser[],
    findBySpotifyId: (
        spotifyId: string,
        displayName?: string,
    ) => Promise<{ id: string } | null>,
    createStub: (
        displayName: string,
        spotifyId: string,
        spotifyDisplayName?: string,
    ) => Promise<{ id: string }>,
): Promise<Map<string, string>> {
    const uniqueSpotifyIds = [
        ...new Set(tracks.map((t) => t.addedBySpotifyId).filter(Boolean)),
    ];

    // Build a display name lookup from the first track we see for each Spotify user
    const displayNameBySpotifyId = new Map<string, string>();
    for (const t of tracks) {
        if (
            t.addedByDisplayName &&
            !displayNameBySpotifyId.has(t.addedBySpotifyId)
        ) {
            displayNameBySpotifyId.set(
                t.addedBySpotifyId,
                t.addedByDisplayName,
            );
        }
    }

    const spotifyToWhatNext = new Map<string, string>();
    for (const spotifyId of uniqueSpotifyIds) {
        const spotifyName = displayNameBySpotifyId.get(spotifyId);
        const user = await findBySpotifyId(spotifyId, spotifyName);
        if (user) {
            spotifyToWhatNext.set(spotifyId, user.id);
        } else {
            const name = spotifyName || spotifyId;
            const stub = await createStub(name, spotifyId, spotifyName);
            spotifyToWhatNext.set(spotifyId, stub.id);
        }
    }

    return spotifyToWhatNext;
}
