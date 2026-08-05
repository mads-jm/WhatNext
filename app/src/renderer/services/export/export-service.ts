/**
 * Export Service
 * Gathers playlist data from RxDB and delegates to format-specific formatters.
 */

import { getDatabase } from '../../db/database';
import { findTracksByIds } from '../../db/query-helpers';
import {
    ALLOWED_REACTIONS,
    type ReactionEmoji,
} from '../../../shared/core/reactions';
import type {
    ExportPlaylist,
    ExportTrack,
    ExportComment,
    ExportFormat,
} from './export-types';
import { formatAsMarkdown } from './markdown-formatter';
import { formatAsHtml } from './html-formatter';
import type { CommentDocType } from '../../db/schemas';

/**
 * Export a playlist: generate content, open save dialog, write to disk.
 * Encapsulates the full export pipeline so components don't need IPC details.
 */
export async function exportAndSave(
    playlistId: string,
    format: ExportFormat,
): Promise<void> {
    const content = await exportPlaylist(playlistId, format);
    const ext = format === 'markdown' ? 'md' : 'html';
    const defaultDir = localStorage.getItem('whatnext:defaultExportDir');
    const defaultPath = defaultDir
        ? `${defaultDir}/playlist-export.${ext}`
        : `playlist-export.${ext}`;
    const result = await window.electron?.dialog.saveFile({
        defaultPath,
        filters: [
            {
                name: format === 'markdown' ? 'Markdown' : 'HTML',
                extensions: [ext],
            },
        ],
    });
    if (result && !result.canceled && result.filePath) {
        await window.electron?.file.write(result.filePath, content);
    }
}

/**
 * Export a playlist in the specified format.
 * Returns the formatted string content.
 */
export async function exportPlaylist(
    playlistId: string,
    format: ExportFormat,
): Promise<string> {
    const data = await gatherExportData(playlistId);

    switch (format) {
        case 'markdown':
            return formatAsMarkdown(data);
        case 'html':
            return formatAsHtml(data);
        default:
            throw new Error(`Unknown export format: ${format}`);
    }
}

async function gatherExportData(playlistId: string): Promise<ExportPlaylist> {
    const db = await getDatabase();
    const playlist = await db.playlists.findOne(playlistId).exec();
    if (!playlist) throw new Error(`Playlist not found: ${playlistId}`);

    const tracks = await findTracksByIds(db, playlist.trackIds);

    // Get all non-deleted comments for this playlist
    const allCommentDocs = await db.comments
        .find({
            selector: { playlistId, isDeleted: false },
        })
        .exec();
    const allComments = allCommentDocs.map((d) => d.toJSON() as CommentDocType);

    // Get all reactions for tracks
    const allReactionDocs = await db.trackInteractions
        .find({
            selector: { interactionType: 'reaction' },
        })
        .exec();

    // Get user display names
    const allUsers = await db.users.find().exec();
    const userMap = new Map(allUsers.map((u) => [u.id, u.displayName]));
    const resolveUser = (id: string) => userMap.get(id) || id;

    // Build comment tree
    const buildCommentTree = (
        comments: CommentDocType[],
        parentId?: string,
    ): ExportComment[] => {
        return comments
            .filter((c) => (c.parentId || undefined) === parentId)
            .map((c) => ({
                author: resolveUser(c.userId),
                body: c.body,
                createdAt: c.createdAt,
                replies: buildCommentTree(comments, c.id),
            }));
    };

    // Playlist-level comments (no trackId)
    const playlistComments = allComments.filter((c) => !c.trackId);

    // Build export tracks
    const exportTracks: ExportTrack[] = tracks.map((track) => {
        const trackComments = allComments.filter((c) => c.trackId === track.id);
        const trackReactions = allReactionDocs.filter(
            (r) => r.trackId === track.id && r.value === 1,
        );

        const reactionCounts = {} as Record<ReactionEmoji, number>;
        for (const emoji of ALLOWED_REACTIONS) {
            reactionCounts[emoji] = trackReactions.filter((r) => {
                try {
                    return JSON.parse(r.metadata || '{}').emoji === emoji;
                } catch {
                    return false;
                }
            }).length;
        }

        return {
            title: track.title,
            artists: track.artists,
            album: track.album,
            durationMs: track.durationMs,
            addedBy: resolveUser(track.addedBy),
            addedAt: track.addedAt,
            spotifyId: track.spotifyId,
            albumArtUrl: track.albumArtUrl,
            reactions: reactionCounts,
            comments: buildCommentTree(trackComments),
        };
    });

    return {
        name: playlist.playlistName,
        description: playlist.description,
        owner: resolveUser(playlist.ownerId),
        collaborators: playlist.collaboratorIds.map(resolveUser),
        tags: playlist.tags,
        createdAt: playlist.createdAt,
        updatedAt: playlist.updatedAt,
        trackCount: tracks.length,
        totalDurationMs: tracks.reduce((sum, t) => sum + t.durationMs, 0),
        tracks: exportTracks,
        comments: buildCommentTree(playlistComments),
        isCollaborative: playlist.isCollaborative,
        queueMode: playlist.queueMode,
        coverArtUrl: playlist.coverArtUrl,
    };
}
