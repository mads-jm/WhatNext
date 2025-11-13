import { useState } from 'react';

type NavItem = {
    id: string;
    label: string;
    icon: string;
    badge?: string;
    children?: NavItem[];
};

const navigationItems: NavItem[] = [
    {
        id: 'workspace',
        label: 'Workspace',
        icon: 'fa-solid fa-folder-open',
        children: [
            { id: 'playlists', label: 'Playlists', icon: 'fa-solid fa-list-music' },
            { id: 'library', label: 'Library', icon: 'fa-solid fa-music', badge: 'Soon' },
            { id: 'sessions', label: 'Sessions', icon: 'fa-solid fa-users', badge: 'Soon' },
        ],
    },
    {
        id: 'p2p',
        label: 'P2P Network',
        icon: 'fa-solid fa-network-wired',
        children: [
            { id: 'p2p-status', label: 'Network Status', icon: 'fa-solid fa-signal' },
            { id: 'p2p-peers', label: 'Peer Management', icon: 'fa-solid fa-users-gear', badge: 'Soon' },
            { id: 'p2p-protocols', label: 'Protocols', icon: 'fa-solid fa-code', badge: 'Dev' },
        ],
    },
    {
        id: 'development',
        label: 'Development',
        icon: 'fa-solid fa-code-branch',
        children: [
            { id: 'rxdb-spike', label: 'RxDB Evaluation', icon: 'fa-solid fa-flask', badge: '#4' },
            { id: 'protocol-testing', label: 'Protocol Testing', icon: 'fa-solid fa-vial', badge: 'Soon' },
            { id: 'debug-console', label: 'Debug Console', icon: 'fa-solid fa-terminal', badge: 'Soon' },
        ],
    },
    {
        id: 'settings',
        label: 'Settings',
        icon: 'fa-solid fa-gear',
        children: [
            { id: 'settings-general', label: 'General', icon: 'fa-solid fa-sliders', badge: 'Soon' },
            { id: 'settings-p2p', label: 'P2P Config', icon: 'fa-solid fa-network-wired', badge: 'Soon' },
            { id: 'settings-storage', label: 'Storage', icon: 'fa-solid fa-database', badge: 'Soon' },
        ],
    },
];

interface SidebarProps {
    activeView: string;
    onNavigate: (viewId: string) => void;
}

export function Sidebar({ activeView, onNavigate }: SidebarProps) {
    const [expandedSections, setExpandedSections] = useState<Set<string>>(
        new Set(['workspace', 'p2p', 'development'])
    );

    const toggleSection = (sectionId: string) => {
        setExpandedSections((prev) => {
            const next = new Set(prev);
            if (next.has(sectionId)) {
                next.delete(sectionId);
            } else {
                next.add(sectionId);
            }
            return next;
        });
    };

    const isActive = (itemId: string) => {
        // Check if this item or any of its children are active
        if (activeView === itemId) return true;

        const item = navigationItems.find(i => i.id === itemId);
        if (item?.children) {
            return item.children.some(child => activeView === child.id);
        }
        return false;
    };

    return (
        <aside className="sidebar flex flex-col bg-gray-900">
            {/* App Header */}
            <div className="px-4 py-4 border-b border-gray-800">
                <div className="flex items-center gap-2">
                    <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg flex items-center justify-center">
                        <i className="fa-solid fa-music text-white text-sm" />
                    </div>
                    <div>
                        <h1 className="text-lg font-bold text-white">WhatNext</h1>
                        <p className="text-xs text-gray-500">v0.0.0 Alpha</p>
                    </div>
                </div>
            </div>

            {/* Navigation */}
            <nav className="flex-1 px-2 py-4 space-y-2 overflow-y-auto">
                {navigationItems.map((section) => (
                    <div key={section.id} className="space-y-0.5">
                        {/* Section Header */}
                        <button
                            onClick={() => {
                                if (section.children) {
                                    toggleSection(section.id);
                                } else {
                                    onNavigate(section.id);
                                }
                            }}
                            className={`
                                w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md
                                text-xs font-semibold transition-colors uppercase tracking-wider
                                ${
                                    isActive(section.id) && !section.children
                                        ? 'bg-blue-600 text-white'
                                        : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800/60'
                                }
                            `}
                        >
                            {section.children && (
                                <i
                                    className={`fa-solid fa-chevron-${
                                        expandedSections.has(section.id) ? 'down' : 'right'
                                    } text-[10px]`}
                                />
                            )}
                            <i className={`${section.icon} text-sm`} />
                            <span className="flex-1 text-left">{section.label}</span>
                            {section.badge && (
                                <span className="px-1.5 py-0.5 bg-gray-700 text-gray-300 rounded text-[10px]">
                                    {section.badge}
                                </span>
                            )}
                        </button>

                        {/* Section Children */}
                        {section.children && expandedSections.has(section.id) && (
                            <div className="ml-3 pl-3 border-l border-gray-800 space-y-0.5">
                                {section.children.map((child) => (
                                    <button
                                        key={child.id}
                                        onClick={() => onNavigate(child.id)}
                                        className={`
                                            w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md
                                            text-sm font-medium transition-colors
                                            ${
                                                activeView === child.id
                                                    ? 'bg-blue-600 text-white'
                                                    : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800/60'
                                            }
                                        `}
                                    >
                                        <i className={`${child.icon} w-4 text-center text-xs`} />
                                        <span className="flex-1 text-left">{child.label}</span>
                                        {child.badge && (
                                            <span
                                                className={`
                                                    px-1.5 py-0.5 rounded text-[10px] font-semibold
                                                    ${
                                                        child.badge === 'Soon'
                                                            ? 'bg-gray-700 text-gray-400'
                                                            : child.badge === 'Dev'
                                                              ? 'bg-orange-900/50 text-orange-400'
                                                              : 'bg-blue-900/50 text-blue-400'
                                                    }
                                                `}
                                            >
                                                {child.badge}
                                            </span>
                                        )}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                ))}
            </nav>

            {/* Quick Actions */}
            <div className="px-2 py-2 border-t border-gray-800 space-y-1">
                <button
                    className="w-full flex items-center gap-2 px-2.5 py-2 rounded-md text-xs font-medium text-gray-400 hover:text-gray-200 hover:bg-gray-800/60 transition-colors"
                    onClick={() => window.electron?.shell.openExternal('https://github.com/mads-jm/whatnext')}
                >
                    <i className="fa-brands fa-github w-4 text-center" />
                    <span>View on GitHub</span>
                </button>
            </div>

            {/* Status Footer */}
            <div className="px-3 py-3 border-t border-gray-800 text-xs">
                <div className="flex items-center justify-between text-gray-500">
                    <div className="flex items-center gap-2">
                        <div className="relative">
                            <i className="fa-solid fa-circle text-green-500 text-[8px]" />
                            <i className="fa-solid fa-circle text-green-500 text-[8px] absolute inset-0 animate-ping" />
                        </div>
                        <span>Local-First Mode</span>
                    </div>
                    <i className="fa-solid fa-database text-gray-600" />
                </div>
            </div>
        </aside>
    );
}
