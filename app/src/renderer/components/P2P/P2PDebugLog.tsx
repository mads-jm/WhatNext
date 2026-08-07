/**
 * P2PDebugLog — scrollable debug log viewer with color-coded levels.
 */

import type { LogEntry } from '../../stores/debug-log-store';

const LOG_LEVEL_COLORS: Record<string, string> = {
    error: 'text-error',
    warn: 'text-secondary',
    success: 'text-primary',
    info: 'text-primary',
};

interface P2PDebugLogProps {
    logs: LogEntry[];
}

export function P2PDebugLog({ logs }: P2PDebugLogProps) {
    return (
        <div className="bg-surface text-primary rounded p-3 font-mono text-xs space-y-1 max-h-64 overflow-y-auto">
            {logs.length === 0 ? (
                <div className="text-on-surface-variant italic">
                    No logs yet
                </div>
            ) : (
                logs.map((log) => (
                    <div key={log.id} className="flex gap-2">
                        <span className="text-on-surface-variant">
                            [{log.time}]
                        </span>
                        <span
                            className={
                                LOG_LEVEL_COLORS[log.level] ?? 'text-primary'
                            }
                        >
                            [{log.level.toUpperCase()}]
                        </span>
                        <span>{log.message}</span>
                    </div>
                ))
            )}
        </div>
    );
}
