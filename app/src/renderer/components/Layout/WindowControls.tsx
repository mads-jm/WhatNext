import { useEffect, useState } from 'react';

/**
 * Custom window chrome — minimize / maximize-restore / close.
 * Hooks into the existing window.electron.window IPC surface.
 * Must sit inside a drag region; these buttons carry their own no-drag override.
 */
export function WindowControls() {
    const [isMaximized, setIsMaximized] = useState(false);

    useEffect(() => {
        // Sync initial state
        window.electron?.window.isMaximized().then(setIsMaximized);

        // Track changes from main process
        const removeMax = window.electron?.window.onMaximized(() => setIsMaximized(true));
        const removeUnmax = window.electron?.window.onUnmaximized(() => setIsMaximized(false));

        return () => {
            removeMax?.();
            removeUnmax?.();
        };
    }, []);

    const btnBase =
        'flex items-center justify-center w-11 h-full transition-colors duration-100 select-none text-on-surface-variant hover:text-on-surface';

    return (
        <div
            className="flex items-stretch h-full shrink-0"
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
            {/* Minimize */}
            <button
                className={`${btnBase} hover:bg-surface-high/60`}
                onClick={() => window.electron?.window.minimize()}
                title="Minimize"
            >
                <svg width="10" height="1" viewBox="0 0 10 1" fill="currentColor">
                    <rect width="10" height="1" />
                </svg>
            </button>

            {/* Maximize / Restore */}
            <button
                className={`${btnBase} hover:bg-surface-high/60`}
                onClick={() => window.electron?.window.maximize()}
                title={isMaximized ? 'Restore' : 'Maximize'}
            >
                {isMaximized ? (
                    // Restore icon (two overlapping squares)
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1">
                        <rect x="2" y="0" width="8" height="8" />
                        <polyline points="0,2 0,10 8,10" />
                    </svg>
                ) : (
                    // Maximize icon (single square)
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1">
                        <rect x="0" y="0" width="10" height="10" />
                    </svg>
                )}
            </button>

            {/* Close */}
            <button
                className={`${btnBase} hover:bg-error hover:text-surface`}
                onClick={() => window.electron?.window.close()}
                title="Close"
            >
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round">
                    <line x1="0" y1="0" x2="10" y2="10" />
                    <line x1="10" y1="0" x2="0" y2="10" />
                </svg>
            </button>
        </div>
    );
}
