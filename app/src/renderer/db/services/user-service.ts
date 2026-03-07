/**
 * User CRUD Service
 * Manages local user identity and linked service accounts.
 * Follows the same patterns as playlist-service.ts and track-service.ts.
 */

import { getDatabase } from '../database';
import type { UserDocType, UserDocument } from '../schemas';
import { v4 as uuidv4 } from 'uuid';

/**
 * Get or create the local user. Core identity function.
 * Called once during app initialization. Idempotent.
 */
export async function getOrCreateLocalUser(): Promise<UserDocument> {
    const db = await getDatabase();

    const existing = await db.users
        .findOne({ selector: { isLocal: true } })
        .exec();

    if (existing) {
        await existing.update({
            $set: { lastSeenAt: new Date().toISOString() },
        });
        return existing;
    }

    // First launch: create local user with placeholder name
    const now = new Date().toISOString();
    const user: UserDocType = {
        id: uuidv4(),
        displayName: 'New User',
        avatarSource: 'none',
        isLocal: true,
        linkedAccounts: [],
        lastSeenAt: now,
        createdAt: now,
        updatedAt: now,
    };

    return db.users.insert(user);
}

/**
 * Get the current local user. Throws if not initialized.
 */
export async function getLocalUser(): Promise<UserDocument> {
    const db = await getDatabase();
    const user = await db.users
        .findOne({ selector: { isLocal: true } })
        .exec();

    if (!user) {
        throw new Error(
            'Local user not initialized. Call getOrCreateLocalUser() first.'
        );
    }
    return user;
}

/**
 * Update the local user's profile fields.
 */
export async function updateLocalUserProfile(updates: {
    displayName?: string;
    bio?: string;
    avatarSource?: UserDocType['avatarSource'];
    avatarLocalPath?: string;
    avatarUrl?: string;
}): Promise<UserDocument> {
    const user = await getLocalUser();
    await user.update({
        $set: {
            ...updates,
            updatedAt: new Date().toISOString(),
        },
    });
    // Re-fetch to get the updated document
    return getLocalUser();
}

/**
 * Link a service account to the local user.
 * Replaces any existing link for the same provider.
 */
export async function linkServiceAccount(account: {
    provider: string;
    providerUserId: string;
    displayName?: string;
    avatarUrl?: string;
}): Promise<UserDocument> {
    const user = await getLocalUser();
    const now = new Date().toISOString();

    // Remove existing link for this provider (replace, don't duplicate)
    const filtered = user.linkedAccounts.filter(
        (a) => a.provider !== account.provider
    );

    await user.update({
        $set: {
            linkedAccounts: [...filtered, { ...account, linkedAt: now }],
            updatedAt: now,
        },
    });
    return getLocalUser();
}

/**
 * Unlink a service account by provider name.
 */
export async function unlinkServiceAccount(
    provider: string
): Promise<UserDocument> {
    const user = await getLocalUser();
    await user.update({
        $set: {
            linkedAccounts: user.linkedAccounts.filter(
                (a) => a.provider !== provider
            ),
            updatedAt: new Date().toISOString(),
        },
    });
    return getLocalUser();
}

/**
 * Create or update a remote peer user from P2P handshake data.
 * Uses the peer's ID as the user document ID.
 */
export async function upsertPeerUser(peerData: {
    peerId: string;
    displayName: string;
    avatarUrl?: string;
}): Promise<UserDocument> {
    const db = await getDatabase();
    const now = new Date().toISOString();

    const existing = await db.users.findOne(peerData.peerId).exec();
    if (existing) {
        await existing.update({
            $set: {
                displayName: peerData.displayName,
                avatarUrl: peerData.avatarUrl,
                lastSeenAt: now,
                updatedAt: now,
            },
        });
        return (await db.users.findOne(peerData.peerId).exec())!;
    }

    return db.users.insert({
        id: peerData.peerId,
        displayName: peerData.displayName,
        avatarUrl: peerData.avatarUrl,
        avatarSource: 'none',
        isLocal: false,
        linkedAccounts: [],
        lastSeenAt: now,
        createdAt: now,
        updatedAt: now,
    });
}
