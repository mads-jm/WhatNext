import { useState } from 'react';
import { useNavigationStore } from '../../stores/navigation-store';
import { useUserStore } from '../../stores/user-store';
import { useP2PStatus } from '../../hooks/useP2PStatus';
import wnorbIcon from '@assets/png/wnorb.png';

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
            { id: 'library', label: 'Library', icon: 'fa-solid fa-music' },
            { id: 'sessions', label: 'Sessions', icon: 'fa-solid fa-users' },
            { id: 'spotify', label: 'Spotify Import', icon: 'fa-brands fa-spotify' },
        ],
    },
    {
        id: 'p2p',
        label: 'P2P Network',
        icon: 'fa-solid fa-network-wired',
        children: [
            { id: 'p2p-status', label: 'Network Status', icon: 'fa-solid fa-signal' },
        ],
    },
    {
        id: 'development',
        label: 'Development',
        icon: 'fa-solid fa-code-branch',
        children: [
            { id: 'dev-dashboard', label: 'Dev Dashboard', icon: 'fa-solid fa-flask', badge: 'Dev' },
        ],
    },
    {
        id: 'settings',
        label: 'Settings',
        icon: 'fa-solid fa-gear',
        children: [
            { id: 'settings-general', label: 'General', icon: 'fa-solid fa-sliders' },
            { id: 'settings-p2p', label: 'P2P Config', icon: 'fa-solid fa-network-wired', badge: 'Soon' },
            { id: 'settings-storage', label: 'Storage', icon: 'fa-solid fa-database', badge: 'Soon' },
        ],
    },
];

export function Sidebar() {
    const activeView = useNavigationStore((s) => s.activeView);
    const navigate = useNavigationStore((s) => s.navigate);
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
                    <img src={wnorbIcon} alt="WhatNext" className="w-8 h-8 rounded-lg" />
                    <div>
                        <h1 className="text-lg font-bold text-white">WhatNext</h1>
                        <p className="text-xs text-gray-500">v0.0.1 Alpha</p>
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
                                    navigate(section.id as any);
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
                                        onClick={() => navigate(child.id as any)}
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

            {/* Identity Bar (Discord-style) */}
            <SidebarIdentityBar />
        </aside>
    );
}

/**
 * Compact identity bar pinned to sidebar bottom.
 * Shows avatar, display name, P2P status, and copy-link action.
 */
function SidebarIdentityBar() {
    const user = useUserStore((s) => s.user);
    const navigate = useNavigationStore((s) => s.navigate);
    const p2p = useP2PStatus();
    const [copied, setCopied] = useState(false);

    const initials = user?.displayName?.slice(0, 2).toUpperCase() || '??';
    const isOnline = p2p.nodeStarted && p2p.connectedPeers.length > 0;

    const copyConnectUrl = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (p2p.peerId) {
            navigator.clipboard.writeText(`whtnxt://connect/${p2p.peerId}`);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        }
    };

    return (
        <div className="px-2 py-2 border-t border-gray-800">
            <div
                className="flex items-center gap-2.5 px-2 py-2 rounded-lg hover:bg-gray-800/60 cursor-pointer transition-colors"
                onClick={() => navigate('settings-general')}
            >
                {/* Avatar with status indicator */}
                <div className="relative shrink-0">
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-600 to-purple-600 flex items-center justify-center text-white text-xs font-bold overflow-hidden">
                        {user?.avatarUrl ? (
                            <img src={user.avatarUrl} alt="" className="w-full h-full object-cover" />
                        ) : (
                            initials
                        )}
                    </div>
                    <div
                        className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-gray-900 ${
                            isOnline ? 'bg-green-500' : p2p.nodeStarted ? 'bg-yellow-500' : 'bg-gray-500'
                        }`}
                    />
                </div>

                {/* Name + status text */}
                <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-gray-200 truncate">
                        {user?.displayName || 'Loading...'}
                    </div>
                    <div className="text-[10px] text-gray-500 truncate">
                        {isOnline
                            ? `${p2p.connectedPeers.length} peer${p2p.connectedPeers.length !== 1 ? 's' : ''}`
                            : p2p.nodeStarted
                              ? 'Online'
                              : 'Offline'}
                    </div>
                </div>

                {/* Copy connection link */}
                {p2p.peerId && (
                    <button
                        onClick={copyConnectUrl}
                        className="shrink-0 w-7 h-7 flex items-center justify-center rounded text-gray-500 hover:text-gray-200 hover:bg-gray-700 transition-colors"
                        title="Copy connection link"
                    >
                        <i className={`fa-solid ${copied ? 'fa-check text-green-400' : 'fa-link'} text-xs`} />
                    </button>
                )}
            </div>
        </div>
    );
}
