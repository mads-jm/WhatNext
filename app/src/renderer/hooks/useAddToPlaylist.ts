/**
 * useAddToPlaylist — encapsulates add-to-playlist operation with feedback timer.
 * Extracted from LibraryView for reuse.
 */

import { useState, useRef, useCallback } from 'react';
import { addTrackToPlaylist } from '../db/services/playlist-service';

export function useAddToPlaylist() {
    const [addingTo, setAddingTo] = useState<{
        trackId: string;
        playlistId: string;
    } | null>(null);
    const [feedback, setFeedback] = useState<string | null>(null);
    const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

    const add = useCallback(
        async (trackId: string, playlistId: string, playlistName: string) => {
            setAddingTo({ trackId, playlistId });
            try {
                await addTrackToPlaylist(playlistId, trackId);
                setFeedback(`Added to "${playlistName}"`);
                clearTimeout(timerRef.current);
                timerRef.current = setTimeout(() => setFeedback(null), 2500);
            } finally {
                setAddingTo(null);
            }
        },
        [],
    );

    return { addingTo, feedback, add };
}
