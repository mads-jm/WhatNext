/**
 * BackendPicker — radio group for selecting the active download backend.
 * Only shown when multiple backends are installed.
 */

import type { BackendStatusResult } from '../../../shared/core/ipc-protocol';

interface BackendPickerProps {
    backends: BackendStatusResult[];
    selected: string;
    onChange: (id: string) => void;
}

export function BackendPicker({ backends, selected, onChange }: BackendPickerProps) {
    const installed = backends.filter((b) => b.installed);
    if (installed.length <= 1) return null;

    return (
        <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-on-surface-variant uppercase tracking-widest">
                Backend
            </span>
            {installed.map((b) => (
                <button
                    key={b.id}
                    onClick={() => onChange(b.id)}
                    className={`px-3 py-1 rounded-lg text-sm font-medium transition-colors ${
                        selected === b.id
                            ? 'bg-primary text-surface'
                            : 'bg-surface-high text-on-surface-variant hover:text-on-surface'
                    }`}
                >
                    {b.name}
                    {b.version && (
                        <span className="ml-1 text-[10px] opacity-60">{b.version}</span>
                    )}
                </button>
            ))}
        </div>
    );
}
