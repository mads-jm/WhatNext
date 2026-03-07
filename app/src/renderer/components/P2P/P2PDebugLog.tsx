/**
 * P2PDebugLog — scrollable debug log viewer with color-coded levels.
 */

import type { LogEntry } from '../../hooks/useP2PDevStatus';

const LOG_LEVEL_COLORS: Record<string, string> = {
    error: 'text-red-400',
    warn: 'text-yellow-400',
    success: 'text-green-400',
    info: 'text-blue-400',
};

interface P2PDebugLogProps {
    logs: LogEntry[];
}

export function P2PDebugLog({ logs }: P2PDebugLogProps) {
    return (
        <div className="bg-gray-900 text-green-400 rounded p-3 font-mono text-xs space-y-1 max-h-64 overflow-y-auto">
            {logs.length === 0 ? (
                <div className="text-gray-500 italic">No logs yet</div>
            ) : (
                logs.map((log) => (
                    <div key={log.id} className="flex gap-2">
                        <span className="text-gray-500">[{log.time}]</span>
                        <span className={LOG_LEVEL_COLORS[log.level] ?? 'text-blue-400'}>
                            [{log.level.toUpperCase()}]
                        </span>
                        <span>{log.message}</span>
                    </div>
                ))
            )}
        </div>
    );
}
