import { useState } from 'react';
import { useUserStore } from '../../stores/user-store';
import { useNavigationStore } from '../../stores/navigation-store';
import { createPlaylist } from '../../db/services/playlist-service';

export function CreatePlaylistDialog() {
    const userId = useUserStore((s) => s.userId);
    const showCreateDialog = useNavigationStore((s) => s.showCreateDialog);
    const selectPlaylist = useNavigationStore((s) => s.selectPlaylist);
    const closeCreateDialog = useNavigationStore((s) => s.closeCreateDialog);

    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [isCollaborative, setIsCollaborative] = useState(false);
    const [queueMode, setQueueMode] = useState<'free_for_all' | 'turn_taking'>('free_for_all');
    const [creating, setCreating] = useState(false);

    if (!showCreateDialog) return null;

    const handleCreate = async () => {
        if (!name.trim()) return;
        setCreating(true);
        try {
            const playlist = await createPlaylist({
                playlistName: name.trim(),
                description: description.trim() || undefined,
                isCollaborative,
                queueMode: isCollaborative ? queueMode : undefined,
                ownerId: userId,
            });
            selectPlaylist(playlist.id);
            setName('');
            setDescription('');
            setIsCollaborative(false);
            setQueueMode('free_for_all');
            closeCreateDialog();
        } catch (error) {
            console.error('Failed to create playlist:', error);
        } finally {
            setCreating(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={closeCreateDialog}>
            <div className="bg-gray-900 border border-gray-700 rounded-xl p-6 w-full max-w-md shadow-2xl" onClick={e => e.stopPropagation()}>
                <h2 className="text-xl font-bold text-gray-100 mb-4">Create Playlist</h2>

                <div className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-400 mb-1">Name</label>
                        <input
                            type="text"
                            value={name}
                            onChange={e => setName(e.target.value)}
                            placeholder="My Awesome Playlist"
                            className="input w-full"
                            autoFocus
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-400 mb-1">Description</label>
                        <input
                            type="text"
                            value={description}
                            onChange={e => setDescription(e.target.value)}
                            placeholder="Optional description..."
                            className="input w-full"
                        />
                    </div>

                    <div className="flex items-center justify-between">
                        <div>
                            <div className="text-sm font-medium text-gray-300">Collaborative</div>
                            <div className="text-xs text-gray-500">Allow others to add tracks via P2P</div>
                        </div>
                        <button
                            onClick={() => setIsCollaborative(!isCollaborative)}
                            className={`w-12 h-6 rounded-full transition-colors ${
                                isCollaborative ? 'bg-blue-600' : 'bg-gray-700'
                            } relative`}
                        >
                            <div className={`w-5 h-5 bg-white rounded-full absolute top-0.5 transition-transform ${
                                isCollaborative ? 'translate-x-6' : 'translate-x-0.5'
                            }`} />
                        </button>
                    </div>

                    {isCollaborative && (
                        <div>
                            <label className="block text-sm font-medium text-gray-400 mb-2">Queue Mode</label>
                            <div className="space-y-2">
                                <label className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                                    queueMode === 'free_for_all' ? 'border-blue-500 bg-blue-950/30' : 'border-gray-700 hover:border-gray-600'
                                }`}>
                                    <input
                                        type="radio"
                                        name="queueMode"
                                        checked={queueMode === 'free_for_all'}
                                        onChange={() => setQueueMode('free_for_all')}
                                        className="accent-blue-500"
                                    />
                                    <div>
                                        <div className="text-sm font-medium text-gray-200">Free for All</div>
                                        <div className="text-xs text-gray-500">Anyone can add tracks anytime</div>
                                    </div>
                                </label>
                                <label className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                                    queueMode === 'turn_taking' ? 'border-blue-500 bg-blue-950/30' : 'border-gray-700 hover:border-gray-600'
                                }`}>
                                    <input
                                        type="radio"
                                        name="queueMode"
                                        checked={queueMode === 'turn_taking'}
                                        onChange={() => setQueueMode('turn_taking')}
                                        className="accent-blue-500"
                                    />
                                    <div>
                                        <div className="text-sm font-medium text-gray-200">Turn Taking</div>
                                        <div className="text-xs text-gray-500">Users take turns adding tracks</div>
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
                        disabled={!name.trim() || creating}
                        className="btn-primary disabled:opacity-50"
                    >
                        {creating ? 'Creating...' : 'Create'}
                    </button>
                </div>
            </div>
        </div>
    );
}
