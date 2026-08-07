/**
 * SharingToggle
 *
 * A labelled toggle that enables/disables file sharing for a playlist.
 * Reads state from the Zustand store; calls setSharing via the useFileTransfer hook.
 */

import { useFileTransferStore } from '../../stores/file-transfer-store';

export interface SharingToggleProps {
    playlistId: string;
    disabled?: boolean;
    /** Called after the toggle changes. Parent is responsible for calling setSharing + registerTracks. */
    onSharingChanged?: (enabled: boolean) => Promise<void>;
}

export function SharingToggle({
    playlistId,
    disabled = false,
    onSharingChanged,
}: SharingToggleProps) {
    const enabled = useFileTransferStore(
        (s) => s.sharingEnabled.get(playlistId) ?? false,
    );
    const setSharingEnabled = useFileTransferStore((s) => s.setSharingEnabled);

    const handleChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (disabled) return;
        const next = e.target.checked;
        setSharingEnabled(playlistId, next);
        if (onSharingChanged) {
            await onSharingChanged(next);
        } else {
            // Fallback: just toggle sharing without registering tracks
            await window.electron?.fileTransfer?.setSharing(playlistId, next);
        }
    };

    return (
        <label
            className={`flex items-center gap-3 cursor-pointer ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
        >
            {/* Toggle switch */}
            <div className="relative">
                <input
                    type="checkbox"
                    className="sr-only"
                    checked={enabled}
                    disabled={disabled}
                    onChange={handleChange}
                />
                <div
                    className={`w-9 h-5 rounded-full transition-colors duration-200 ${
                        enabled ? 'bg-primary' : 'bg-surface-high'
                    }`}
                />
                <div
                    className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform duration-200 ${
                        enabled ? 'translate-x-4' : 'translate-x-0'
                    }`}
                />
            </div>
            <div className="space-y-0.5">
                <span className="text-xs font-medium text-on-surface">
                    Share files with peers
                </span>
                {!disabled && (
                    <p className="text-[10px] text-on-surface-variant">
                        {enabled
                            ? 'Peers can request your audio and artwork files'
                            : 'File sharing is off — peers cannot request files from you'}
                    </p>
                )}
                {disabled && (
                    <p className="text-[10px] text-on-surface-variant">
                        Start a session to enable file sharing
                    </p>
                )}
            </div>
        </label>
    );
}
