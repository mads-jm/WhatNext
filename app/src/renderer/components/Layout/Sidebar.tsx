import { useState } from 'react';
import { useNavigationStore, type ViewId } from '../../stores/navigation-store';
import { useUserStore } from '../../stores/user-store';
import { useP2PStatus } from '../../hooks/useP2PStatus';
import wnorbIcon from '@assets/png/wnorb.png';

type NavItem = {
    // Every entry below is a destination the navigation store knows about, so
    // narrowing this from `string` lets `navigate(item.id)` type-check without
    // a cast — and makes a typo'd destination a compile error.
    id: ViewId;
    label: string;
    icon: string;
    badge?: string;
    section?: string;
};

const navigationItems: NavItem[] = [
    // Workspace
    { id: 'playlists', label: 'Playlists', icon: 'fa-solid fa-headphones', section: 'Workspace' },
    { id: 'library', label: 'Library', icon: 'fa-solid fa-music', section: 'Workspace' },
    { id: 'sessions', label: 'Sessions', icon: 'fa-solid fa-users', section: 'Workspace' },
    { id: 'spotify', label: 'Spotify Import', icon: 'fa-brands fa-spotify', section: 'Workspace' },
    { id: 'localImport', label: 'Local Files', icon: 'fa-solid fa-folder-open', section: 'Workspace' },
    { id: 'download', label: 'Download', icon: 'fa-solid fa-cloud-arrow-down', section: 'Workspace' },
    // P2P Network
    { id: 'p2p-status', label: 'Network Status', icon: 'fa-solid fa-signal', section: 'Network' },
    { id: 'p2p-config', label: 'Relay Servers', icon: 'fa-solid fa-tower-broadcast', section: 'Network' },
    // Development
    { id: 'dev-dashboard', label: 'Dev Dashboard', icon: 'fa-solid fa-flask', badge: 'Dev', section: 'Development' },
    // Settings
    { id: 'settings-general', label: 'General', icon: 'fa-solid fa-sliders', section: 'Settings' },
    { id: 'settings-storage', label: 'Storage', icon: 'fa-solid fa-database', section: 'Settings' },
    { id: 'settings-download', label: 'Download', icon: 'fa-solid fa-cloud-arrow-down', section: 'Settings' },
    { id: 'settings-appearance', label: 'Appearance', icon: 'fa-solid fa-palette', section: 'Settings' },
];

// Group items by section for visual labels
const sections = [...new Set(navigationItems.map((i) => i.section))];

export function Sidebar() {
    const activeView = useNavigationStore((s) => s.activeView);
    const navigate = useNavigationStore((s) => s.navigate);

    return (
        <aside className="sidebar flex flex-col bg-surface-lowest">
            {/* App Header — draggable to match toolbar height */}
            <div
                className="px-4 py-4 border-b border-outline-variant/10"
                style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
            >
                <div
                    className="flex items-center gap-2"
                    style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
                >
                    <img src={wnorbIcon} alt="WhatNext" className="w-8 h-8 rounded-lg" />
                    <div>
                        <h1 className="text-lg font-bold text-on-surface font-headline">WhatNext</h1>
                        <p className="text-xs text-on-surface-variant">v0.0.1 Alpha</p>
                    </div>
                </div>
            </div>

            {/* Start Session CTA */}
            <div className="px-3 pt-4 pb-2">
                <button
                    onClick={() => navigate('sessions')}
                    className="w-full bg-gradient-to-r from-primary to-primary-dim text-surface font-headline font-bold rounded-xl px-4 py-2.5 text-sm transition-opacity hover:opacity-90"
                >
                    <i className="fa-solid fa-bolt mr-2" />
                    Start Session
                </button>
            </div>

            {/* Navigation */}
            <nav className="flex-1 px-2 py-2 space-y-1 overflow-y-auto">
                {sections.map((sectionLabel) => (
                    <div key={sectionLabel} className="space-y-0.5">
                        {/* Section label — visual grouping, no collapse */}
                        <div className="text-[10px] uppercase tracking-widest text-on-surface-variant px-2.5 pt-3 pb-1">
                            {sectionLabel}
                        </div>

                        {navigationItems
                            .filter((item) => item.section === sectionLabel)
                            .map((item) => (
                                <button
                                    key={item.id}
                                    onClick={() => navigate(item.id)}
                                    className={`
                                        w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md
                                        text-sm font-medium transition-colors
                                        ${
                                            activeView === item.id
                                                ? 'border-l-2 border-primary bg-primary/5 text-on-surface'
                                                : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-high'
                                        }
                                    `}
                                >
                                    <i className={`${item.icon} w-4 text-center text-xs`} />
                                    <span className="flex-1 text-left">{item.label}</span>
                                    {item.badge && (
                                        <span
                                            className={`
                                                px-1.5 py-0.5 rounded text-[10px] font-semibold
                                                ${
                                                    item.badge === 'Dev'
                                                        ? 'bg-tertiary/15 text-tertiary'
                                                        : 'bg-primary/15 text-primary'
                                                }
                                            `}
                                        >
                                            {item.badge}
                                        </span>
                                    )}
                                </button>
                            ))}
                    </div>
                ))}
            </nav>

            {/* Quick Actions */}
            <div className="px-2 py-2 border-t border-outline-variant/10 space-y-1">
                <button
                    className="w-full flex items-center gap-2 px-2.5 py-2 rounded-md text-xs font-medium text-on-surface-variant hover:text-on-surface hover:bg-surface-high transition-colors"
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
        <div className="px-2 py-2 border-t border-outline-variant/10">
            <div
                className="w-full flex items-center gap-2.5 px-2 py-2 rounded-lg hover:bg-surface-high cursor-pointer transition-colors"
                onClick={() => navigate('settings-general')}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') navigate('settings-general'); }}
            >
                {/* Avatar with status indicator */}
                <div className="relative shrink-0">
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary to-primary-dim flex items-center justify-center text-surface text-xs font-bold overflow-hidden">
                        {user?.avatarUrl ? (
                            <img src={user.avatarUrl} alt="" className="w-full h-full object-cover" />
                        ) : (
                            initials
                        )}
                    </div>
                    <div
                        className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-surface-lowest ${
                            isOnline ? 'bg-primary' : p2p.nodeStarted ? 'bg-secondary' : 'bg-on-surface-variant'
                        }`}
                    />
                </div>

                {/* Name + status text */}
                <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-on-surface truncate">
                        {user?.displayName || 'Loading...'}
                    </div>
                    <div className="text-[10px] text-on-surface-variant truncate">
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
                        className="shrink-0 w-7 h-7 flex items-center justify-center rounded text-on-surface-variant hover:text-on-surface hover:bg-surface-high transition-colors"
                        title="Copy connection link"
                    >
                        <i className={`fa-solid ${copied ? 'fa-check text-primary' : 'fa-link'} text-xs`} />
                    </button>
                )}
            </div>
        </div>
    );
}
