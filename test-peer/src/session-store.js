/**
 * WhatNext Test Peer — In-Memory Session Store
 *
 * Maintains all replicated documents in memory with LWW conflict resolution.
 * Document shapes match app/src/renderer/db/schemas.ts.
 *
 * LWW is NOT reimplemented here. `incomingWins` / `contentKey` are imported from
 * app/src/shared/lww/index.js — the same module the app's renderer imports — so
 * the two peers cannot elect different winners for the same conflict (#58).
 */

import { randomUUID } from 'crypto';
import chalk from 'chalk';
import { incomingWins, envelopeCandidate } from '../../app/src/shared/lww/index.js';

// ─── Collections ─────────────────────────────────────────────────────────────

/**
 * One Map<id, {id, data, updatedAt, deleted?}> per collection.
 * @type {Record<string, Map<string, object>>}
 */
const collections = {
    playlists: new Map(),
    tracks: new Map(),
    trackInteractions: new Map(),
    users: new Map(),
};

/**
 * Per-collection checkpoint: ISO timestamp of the newest accepted doc.
 * Sent in pull-request messages so the remote only returns newer documents.
 * @type {Map<string, string|null>}
 */
const checkpoints = new Map([
    ['playlists', null],
    ['tracks', null],
    ['trackInteractions', null],
    ['users', null],
]);

/**
 * Handshake info keyed by peerId.
 * @type {Map<string, object>}
 */
const handshakeInfoByPeer = new Map();

// ─── LWW merge ───────────────────────────────────────────────────────────────

/**
 * Apply LWW for a single document. Incoming wins if there is no existing doc, or
 * if the shared comparator says so.
 *
 * Was a raw `incoming.updatedAt > existing.updatedAt` string compare (pre-#54
 * semantics), which mis-sorts across ISO format/precision drift and has no
 * tie-break — so on equal timestamps the test peer kept its copy while the app
 * picked a content-derived winner, and the two diverged permanently.
 *
 * Everything stored here is a replication envelope, so BOTH sides project
 * through the shared `envelopeCandidate`. The app compares an envelope against
 * an RxDocument (`storedCandidate`); both projections drop the same
 * non-discriminating keys, so the two peers elect the same winner.
 *
 * @param {Map} collectionMap
 * @param {{id: string, data: object, updatedAt: string, deleted?: boolean}} incoming
 * @returns {{ applied: boolean, previous: object|null }}
 */
function applyLWW(collectionMap, incoming) {
    const existing = collectionMap.get(incoming.id);
    if (!existing || incomingWins(envelopeCandidate(incoming), envelopeCandidate(existing))) {
        collectionMap.set(incoming.id, incoming);
        return { applied: true, previous: existing ?? null };
    }
    return { applied: false, previous: existing };
}

// ─── Core API ────────────────────────────────────────────────────────────────

/**
 * Apply an array of replication documents to a named collection.
 * Runs LWW on each. Returns a change summary used by logChangeSummary.
 *
 * @param {string} collection
 * @param {Array<{id: string, data: object, updatedAt: string, deleted?: boolean}>} documents
 * @returns {{ applied: number, skipped: number, deleted: number, changes: Array }}
 */
export function applyDocuments(collection, documents) {
    const map = collections[collection];
    if (!map) {
        console.warn(`[Store] Unknown collection: ${collection}`);
        return { applied: 0, skipped: 0, deleted: 0, changes: [] };
    }

    let applied = 0;
    let skipped = 0;
    let deleted = 0;
    const changes = [];

    for (const doc of documents) {
        const { applied: wasApplied, previous } = applyLWW(map, doc);
        if (wasApplied) {
            applied++;
            if (doc.deleted) deleted++;
            changes.push({
                id: doc.id,
                type: doc.deleted ? 'delete' : 'upsert',
                previous,
                incoming: doc,
            });
        } else {
            skipped++;
            changes.push({ id: doc.id, type: 'skipped', previous, incoming: doc });
        }
    }

    // Update checkpoint to the max updatedAt among accepted documents.
    // Deliberately still a string compare (not parseTimestampMs): checkpoints are
    // only ever compared against other checkpoints/updatedAt values, and every
    // producer on both sides emits `new Date().toISOString()` — one format, one
    // precision, UTC — so lexicographic order equals chronological order here.
    // Unlike the LWW merge above, a checkpoint has no cross-peer tie-break to
    // diverge on. See impl notes for #58.
    const accepted = documents.filter((_, i) => changes[i]?.type !== 'skipped');
    if (accepted.length > 0) {
        const maxTs = accepted.reduce((max, d) => (d.updatedAt > max ? d.updatedAt : max), '');
        const current = checkpoints.get(collection) ?? '';
        if (maxTs > current) {
            checkpoints.set(collection, maxTs);
        }
    }

    return { applied, skipped, deleted, changes };
}

/**
 * Retrieve all live (non-deleted) documents for a collection as replication
 * envelopes. Filters to docs newer than checkpoint (null = return all).
 *
 * @param {string} collection
 * @param {string|null} checkpoint
 * @param {number} [limit=100]
 * @returns {{ documents: object[], checkpoint: string }}
 */
export function getDocuments(collection, checkpoint, limit = 100) {
    const map = collections[collection];
    if (!map) return { documents: [], checkpoint: checkpoint ?? '' };

    let docs = Array.from(map.values());
    if (checkpoint) {
        docs = docs.filter(d => d.updatedAt > checkpoint);
    }
    docs.sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
    docs = docs.slice(0, limit);

    const newCheckpoint =
        docs.length > 0
            ? docs[docs.length - 1].updatedAt
            : (checkpoints.get(collection) ?? '');

    return { documents: docs, checkpoint: newCheckpoint };
}

// ─── Handshake info ──────────────────────────────────────────────────────────

export function setHandshakeInfo(peerId, data) {
    handshakeInfoByPeer.set(peerId, data);
}

export function getHandshakeInfo(peerId) {
    return handshakeInfoByPeer.get(peerId);
}

export function removeHandshakeInfo(peerId) {
    handshakeInfoByPeer.delete(peerId);
}

// ─── Document factories ──────────────────────────────────────────────────────

/**
 * Create a track document envelope ready for replication.
 * Matches TrackDocType from schemas.ts.
 *
 * @param {string} title
 * @param {string} artist
 * @param {string} addedBy - local user ID
 * @returns {{id: string, data: object, updatedAt: string}}
 */
export function createTrackDocument(title, artist, addedBy) {
    const id = randomUUID();
    const now = new Date().toISOString();
    return {
        id,
        data: {
            id,
            title,
            artists: [artist],
            album: 'Unknown',
            durationMs: 0,
            addedAt: now,
            addedBy,
        },
        updatedAt: now,
    };
}

/**
 * Create a trackInteraction vote document envelope.
 * id is composite: `${userId}_${trackId}_vote`.
 *
 * @param {string} userId
 * @param {string} trackId
 * @param {number} value - +1 or -1
 * @returns {{id: string, data: object, updatedAt: string}}
 */
export function createVoteDocument(userId, trackId, value) {
    const id = `${userId}_${trackId}_vote`;
    const now = new Date().toISOString();
    return {
        id,
        data: {
            id,
            userId,
            trackId,
            interactionType: 'vote',
            value,
            updatedAt: now,
        },
        updatedAt: now,
    };
}

// ─── Indexed track list ───────────────────────────────────────────────────────

/**
 * Return ordered array of live (non-deleted) track documents.
 * Used for 1-based index lookup in CLI commands.
 *
 * @returns {Array<{id: string, data: object, updatedAt: string}>}
 */
export function getTracksList() {
    return Array.from(collections.tracks.values()).filter(d => !d.deleted);
}

// ─── Display helpers ──────────────────────────────────────────────────────────

/**
 * Return a chalk-formatted summary of the first playlist in the store.
 * Shows track list, queue mode, turn state, and vote tallies.
 *
 * @returns {string}
 */
export function formatPlaylistDisplay() {
    const playlists = Array.from(collections.playlists.values()).filter(d => !d.deleted);
    if (playlists.length === 0) {
        return chalk.yellow('No playlist data. Run "pull" to fetch from a connected peer.');
    }

    const playlist = playlists[0].data;
    const lines = [];

    lines.push(chalk.cyan(`\n🎵 Playlist: ${playlist.playlistName ?? '(unnamed)'}`));
    lines.push(chalk.gray(`   ID:    ${playlist.id}`));
    lines.push(chalk.gray(`   Owner: ${playlist.ownerId ?? '—'}`));
    lines.push(chalk.gray(`   Mode:  ${playlist.queueMode ?? 'free_for_all'}`));
    if (playlist.isCollaborative) {
        lines.push(chalk.gray(`   Collaborative: yes`));
    }

    // Turn-taking info
    if (playlist.queueMode === 'turn_taking') {
        const turnUser = _resolveDisplayName(playlist.currentTurnUserId);
        lines.push(chalk.magenta(`\n   🎲 Turn: ${turnUser}`));
        lines.push(chalk.gray(
            `   Progress: ${playlist.turnTracksAdded ?? 0}/${playlist.tracksPerTurn ?? 1} tracks` +
            (playlist.maxTurns ? ` | Turn ${playlist.turnsCompleted ?? 0}/${playlist.maxTurns}` : ''),
        ));
        if (playlist.isComplete) {
            lines.push(chalk.green('   ✅ Playlist marked complete'));
        }
    }

    // Vote tallies per track
    const voteTallies = _buildVoteTallies();

    // Track list
    const trackIds = playlist.trackIds ?? [];
    if (trackIds.length === 0) {
        lines.push(chalk.gray('\n   No tracks yet.'));
    } else {
        lines.push(chalk.bold(`\n   Tracks (${trackIds.length}):`));
        trackIds.forEach((tid, i) => {
            const track = collections.tracks.get(tid);
            const label = track
                ? `${track.data.title} — ${(track.data.artists ?? []).join(', ')}`
                : `(unknown track ${tid.slice(0, 8)}...)`;
            const votes = voteTallies[tid] ?? 0;
            const voteStr = votes !== 0
                ? (votes > 0 ? chalk.green(` [+${votes}]`) : chalk.red(` [${votes}]`))
                : '';
            lines.push(`   ${chalk.white(`${i + 1}.`)} ${label}${voteStr}`);
        });
    }

    lines.push('');
    return lines.join('\n');
}

/**
 * Return a chalk-formatted list of all known tracks with 1-based indices.
 *
 * @returns {string}
 */
export function formatTracksDisplay() {
    const tracks = getTracksList();
    if (tracks.length === 0) {
        return chalk.yellow('\nNo track data. Run "pull" to fetch from a connected peer.\n');
    }

    const lines = [chalk.cyan(`\n🎵 Tracks (${tracks.length}):\n`)];
    tracks.forEach((doc, i) => {
        const t = doc.data;
        lines.push(
            chalk.white(`  ${i + 1}. ${t.title ?? '(untitled)'}`) +
            chalk.gray(` — ${(t.artists ?? []).join(', ')} | added by: ${(t.addedBy ?? '').slice(0, 8)}...`),
        );
    });
    lines.push('');
    return lines.join('\n');
}

/**
 * Return a chalk-formatted summary of handshake info for all known peers.
 *
 * @returns {string}
 */
export function formatPeersInfoDisplay() {
    if (handshakeInfoByPeer.size === 0) {
        return chalk.yellow('\nNo handshake data yet. Connect to a peer first.\n');
    }

    const lines = [chalk.cyan(`\n🤝 Peer Handshake Info (${handshakeInfoByPeer.size}):\n`)];
    for (const [peerId, data] of handshakeInfoByPeer.entries()) {
        lines.push(chalk.white(`  ${data.displayName ?? '(unknown)'}`));
        lines.push(chalk.gray(`    Peer ID:      ${peerId.slice(0, 40)}...`));
        lines.push(chalk.gray(`    User ID:      ${(data.userId ?? '').slice(0, 8)}...`));
        lines.push(chalk.gray(`    Version:      ${data.version ?? '—'}`));
        lines.push(chalk.gray(`    Capabilities: ${(data.capabilities ?? []).join(', ')}`));
        lines.push('');
    }
    return lines.join('\n');
}

/**
 * Return a chalk-formatted full session state overview.
 *
 * @returns {string}
 */
export function formatSessionDisplay() {
    const lines = [chalk.cyan('\n📊 Session State:\n')];

    for (const [name, map] of Object.entries(collections)) {
        const total = map.size;
        const live = Array.from(map.values()).filter(d => !d.deleted).length;
        const cp = checkpoints.get(name) ?? 'none';
        lines.push(
            chalk.white(`  ${name.padEnd(20)}`) +
            chalk.gray(`${live} live / ${total} total | checkpoint: ${cp}`),
        );
    }

    lines.push('');
    lines.push(chalk.white('  Connected peers:  ') + chalk.gray(handshakeInfoByPeer.size));
    for (const [peerId, data] of handshakeInfoByPeer.entries()) {
        lines.push(chalk.gray(`    ${data.displayName ?? '?'} (${peerId.slice(0, 16)}...)`));
    }

    lines.push('');
    return lines.join('\n');
}

// ─── Checkpoint access ────────────────────────────────────────────────────────

/**
 * Return the stored checkpoint for a collection (null if none yet).
 * Used by the CLI pull command to request only newer documents.
 *
 * @param {string} collection
 * @returns {string|null}
 */
export function getCheckpoint(collection) {
    return checkpoints.get(collection) ?? null;
}

// ─── Change logging ──────────────────────────────────────────────────────────

/**
 * Log a human-readable summary of document changes after applyDocuments.
 * Detects: track additions/removals in playlists, turn state changes,
 * individual track upserts/deletes, and vote interactions.
 *
 * @param {Array} changes - the changes array from applyDocuments
 * @param {string} collection
 */
export function logChangeSummary(changes, collection) {
    const relevant = changes.filter(c => c.type !== 'skipped');
    if (relevant.length === 0) return;

    console.log(chalk.yellow(`\n[Store] ${collection}: ${relevant.length} change(s)`));

    for (const change of relevant) {
        if (change.type === 'delete') {
            console.log(chalk.red(`  ✕ Deleted: ${change.id.slice(0, 16)}...`));
            continue;
        }

        const data = change.incoming?.data ?? {};
        const prev = change.previous?.data ?? null;

        if (collection === 'playlists') {
            _logPlaylistChange(data, prev);
        } else if (collection === 'tracks') {
            console.log(chalk.green(
                `  + Track: ${data.title ?? '?'} — ${(data.artists ?? []).join(', ')}`,
            ));
        } else if (collection === 'trackInteractions') {
            if (data.interactionType === 'vote') {
                const sign = (data.value ?? 0) > 0 ? '+1' : '-1';
                console.log(chalk.yellow(
                    `  👍 Vote: ${(data.userId ?? '?').slice(0, 8)}... voted ${sign} on ${(data.trackId ?? '').slice(0, 8)}...`,
                ));
            }
        } else if (collection === 'users') {
            console.log(chalk.gray(`  👤 User: ${data.displayName ?? data.id}`));
        }
    }
    console.log('');
}

// ─── Private helpers ──────────────────────────────────────────────────────────

function _resolveDisplayName(userId) {
    if (!userId) return '(nobody)';
    const user = collections.users.get(userId);
    return user?.data?.displayName ?? userId.slice(0, 8) + '...';
}

function _buildVoteTallies() {
    const tallies = {};
    for (const doc of collections.trackInteractions.values()) {
        if (doc.deleted || doc.data?.interactionType !== 'vote') continue;
        const { trackId, value } = doc.data;
        if (trackId) tallies[trackId] = (tallies[trackId] ?? 0) + (value ?? 0);
    }
    return tallies;
}

function _logPlaylistChange(data, prev) {
    const prevTrackIds = prev?.trackIds ?? [];
    const newTrackIds = data.trackIds ?? [];

    const added = newTrackIds.filter(id => !prevTrackIds.includes(id));
    const removed = prevTrackIds.filter(id => !newTrackIds.includes(id));

    for (const id of added) {
        const track = collections.tracks.get(id);
        const label = track ? `${track.data.title} — ${(track.data.artists ?? []).join(', ')}` : id.slice(0, 16);
        console.log(chalk.green(`  + Track added to playlist: ${label}`));
    }
    for (const id of removed) {
        const track = collections.tracks.get(id);
        const label = track ? track.data.title : id.slice(0, 16);
        console.log(chalk.red(`  - Track removed from playlist: ${label}`));
    }

    // Turn state
    if (prev && data.currentTurnUserId !== prev.currentTurnUserId) {
        const name = _resolveDisplayName(data.currentTurnUserId);
        console.log(chalk.magenta(`  🎲 Turn changed to: ${name}`));
    }
    if (data.isComplete && !prev?.isComplete) {
        console.log(chalk.green('  ✅ Playlist marked complete!'));
    }
    if (data.queueMode !== prev?.queueMode) {
        console.log(chalk.gray(`  Mode changed to: ${data.queueMode}`));
    }
}
