/**
 * Export Data Types
 * Intermediate representation for playlist export.
 */

import type { ReactionEmoji } from '../../db/services/reaction-service';

export interface ExportComment {
    author: string;
    body: string;
    createdAt: string;
    replies: ExportComment[];
}

export interface ExportTrack {
    title: string;
    artists: string[];
    album: string;
    durationMs: number;
    addedBy: string;
    addedAt: string;
    spotifyId?: string;
    albumArtUrl?: string;
    reactions: Record<ReactionEmoji, number>;
    comments: ExportComment[];
}

export interface ExportPlaylist {
    name: string;
    description?: string;
    owner: string;
    collaborators: string[];
    tags: string[];
    createdAt: string;
    updatedAt: string;
    trackCount: number;
    totalDurationMs: number;
    tracks: ExportTrack[];
    comments: ExportComment[];
    isCollaborative: boolean;
    queueMode?: string;
    coverArtUrl?: string;
}

export type ExportFormat = 'markdown' | 'html';
