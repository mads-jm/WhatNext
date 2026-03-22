import { useReducer } from 'react';
import { useUserStore } from '../../stores/user-store';
import { useNavigationStore } from '../../stores/navigation-store';
import { createPlaylist } from '../../db/services/playlist-service';

type FormState = {
    name: string;
    description: string;
    isCollaborative: boolean;
    queueMode: 'free_for_all' | 'turn_taking';
    creating: boolean;
};

type FormAction =
    | { type: 'SET_NAME'; value: string }
    | { type: 'SET_DESCRIPTION'; value: string }
    | { type: 'SET_COLLABORATIVE'; value: boolean }
    | { type: 'SET_QUEUE_MODE'; value: 'free_for_all' | 'turn_taking' }
    | { type: 'SET_CREATING'; value: boolean }
    | { type: 'RESET' };

const initialFormState: FormState = {
    name: '',
    description: '',
    isCollaborative: false,
    queueMode: 'free_for_all',
    creating: false,
};

function formReducer(state: FormState, action: FormAction): FormState {
    switch (action.type) {
        case 'SET_NAME':
            return { ...state, name: action.value };
        case 'SET_DESCRIPTION':
            return { ...state, description: action.value };
        case 'SET_COLLABORATIVE':
            return { ...state, isCollaborative: action.value };
        case 'SET_QUEUE_MODE':
            return { ...state, queueMode: action.value };
        case 'SET_CREATING':
            return { ...state, creating: action.value };
        case 'RESET':
            return initialFormState;
    }
}

export function CreatePlaylistDialog() {
    const userId = useUserStore((s) => s.userId);
    const showCreateDialog = useNavigationStore((s) => s.showCreateDialog);
    const selectPlaylist = useNavigationStore((s) => s.selectPlaylist);
    const closeCreateDialog = useNavigationStore((s) => s.closeCreateDialog);

    const [form, dispatch] = useReducer(formReducer, initialFormState);

    if (!showCreateDialog) return null;

    const handleCreate = async () => {
        if (!form.name.trim()) return;
        dispatch({ type: 'SET_CREATING', value: true });
        try {
            const playlist = await createPlaylist({
                playlistName: form.name.trim(),
                description: form.description.trim() || undefined,
                isCollaborative: form.isCollaborative,
                queueMode: form.isCollaborative ? form.queueMode : undefined,
                ownerId: userId,
            });
            selectPlaylist(playlist.id);
            dispatch({ type: 'RESET' });
            closeCreateDialog();
        } catch (error) {
            console.error('Failed to create playlist:', error);
        } finally {
            dispatch({ type: 'SET_CREATING', value: false });
        }
    };

    return (
        <div
            className="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
            role="button"
            tabIndex={0}
            onClick={closeCreateDialog}
            onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') closeCreateDialog();
            }}
        >
            <div
                className="bg-surface border border-outline-variant rounded-xl p-6 w-full max-w-md shadow-2xl"
                role="presentation"
                onClick={e => e.stopPropagation()}
            >
                <h2 className="text-xl font-bold text-on-surface mb-4">Create Playlist</h2>

                <div className="space-y-4">
                    <div>
                        <label htmlFor="playlist-name" className="block text-sm font-medium text-on-surface-variant mb-1">Name</label>
                        <input
                            id="playlist-name"
                            type="text"
                            value={form.name}
                            onChange={e => dispatch({ type: 'SET_NAME', value: e.target.value })}
                            placeholder="My Awesome Playlist"
                            className="input w-full"
                        />
                    </div>

                    <div>
                        <label htmlFor="playlist-description" className="block text-sm font-medium text-on-surface-variant mb-1">Description</label>
                        <input
                            id="playlist-description"
                            type="text"
                            value={form.description}
                            onChange={e => dispatch({ type: 'SET_DESCRIPTION', value: e.target.value })}
                            placeholder="Optional description..."
                            className="input w-full"
                        />
                    </div>

                    <div className="flex items-center justify-between">
                        <div>
                            <div className="text-sm font-medium text-on-surface">Collaborative</div>
                            <div className="text-xs text-on-surface-variant">Allow others to add tracks via P2P</div>
                        </div>
                        <button
                            onClick={() => dispatch({ type: 'SET_COLLABORATIVE', value: !form.isCollaborative })}
                            className={`w-12 h-6 rounded-full transition-colors ${
                                form.isCollaborative ? 'bg-primary' : 'bg-surface-high'
                            } relative`}
                        >
                            <div className={`w-5 h-5 bg-on-surface rounded-full absolute top-0.5 transition-transform ${
                                form.isCollaborative ? 'translate-x-6' : 'translate-x-0.5'
                            }`} />
                        </button>
                    </div>

                    {form.isCollaborative && (
                        <div>
                            <p className="block text-sm font-medium text-on-surface-variant mb-2">Queue Mode</p>
                            <div className="space-y-2">
                                <label aria-label="Free for All" className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                                    form.queueMode === 'free_for_all' ? 'border-primary bg-primary/10' : 'border-outline-variant hover:border-on-surface-variant'
                                }`}>
                                    <input
                                        id="queue-mode-free"
                                        type="radio"
                                        name="queueMode"
                                        checked={form.queueMode === 'free_for_all'}
                                        onChange={() => dispatch({ type: 'SET_QUEUE_MODE', value: 'free_for_all' })}
                                        className="accent-primary"
                                    />
                                    <div>
                                        <div className="text-sm font-medium text-on-surface">Free for All</div>
                                        <div className="text-xs text-on-surface-variant">Anyone can add tracks anytime</div>
                                    </div>
                                </label>
                                <label aria-label="Turn Taking" className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                                    form.queueMode === 'turn_taking' ? 'border-primary bg-primary/10' : 'border-outline-variant hover:border-on-surface-variant'
                                }`}>
                                    <input
                                        id="queue-mode-turn"
                                        type="radio"
                                        name="queueMode"
                                        checked={form.queueMode === 'turn_taking'}
                                        onChange={() => dispatch({ type: 'SET_QUEUE_MODE', value: 'turn_taking' })}
                                        className="accent-primary"
                                    />
                                    <div>
                                        <div className="text-sm font-medium text-on-surface">Turn Taking</div>
                                        <div className="text-xs text-on-surface-variant">Users take turns adding tracks</div>
                                    </div>
                                </label>
                            </div>
                        </div>
                    )}
                </div>

                <div className="flex justify-end gap-3 mt-6">
                    <button onClick={closeCreateDialog} className="btn-ghost">Cancel</button>
                    <button
                        onClick={handleCreate}
                        disabled={!form.name.trim() || form.creating}
                        className="btn-primary disabled:opacity-50"
                    >
                        {form.creating ? 'Creating...' : 'Create'}
                    </button>
                </div>
            </div>
        </div>
    );
}
