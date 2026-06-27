/**
 * P2PSection — collapsible section wrapper used throughout the P2P dev interface.
 */

import type { ReactNode } from 'react';

interface P2PSectionProps {
    title: string;
    expanded?: boolean;
    onToggle?: () => void;
    badge?: ReactNode;
    children: ReactNode;
}

export function P2PSection({ title, expanded = false, onToggle, badge, children }: P2PSectionProps) {
    return (
        <div className="bg-surface-high rounded-lg overflow-hidden">
            <button
                onClick={onToggle}
                className="w-full px-4 py-3 flex items-center justify-between bg-surface-high hover:bg-outline-variant/30 transition-colors"
            >
                <div className="flex items-center gap-2">
                    <span className="font-bold text-on-surface text-sm">{title}</span>
                    {badge}
                </div>
                {onToggle && <span className="text-on-surface-variant">{expanded ? '\u25BC' : '\u25B6'}</span>}
            </button>
            {expanded && <div className="p-4">{children}</div>}
        </div>
    );
}
