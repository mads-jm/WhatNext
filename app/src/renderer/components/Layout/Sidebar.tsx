import { useState } from 'react';

type NavItem = {
    id: string;
    label: string;
    icon: string;
};

const navigationItems: NavItem[] = [
    { id: 'playlists', label: 'Playlists', icon: 'fa-solid fa-list-music' },
    { id: 'library', label: 'Library', icon: 'fa-solid fa-music' },
    { id: 'sessions', label: 'Sessions', icon: 'fa-solid fa-users' },
    { id: 'spike', label: 'RxDB Spike', icon: 'fa-solid fa-flask' },
    { id: 'settings', label: 'Settings', icon: 'fa-solid fa-gear' },
];

interface SidebarProps {
    activeView: string;
    onNavigate: (viewId: string) => void;
}

export function Sidebar({ activeView, onNavigate }: SidebarProps) {
    return (
        <aside className="sidebar flex flex-col">
            {/* App Title */}
            <div className="px-4 py-4 border-b border-gray-800">
                <h1 className="text-xl font-bold text-primary-400">WhatNext</h1>
                <p className="text-xs text-gray-500 mt-1">
                    Resilient Music Platform
                </p>
            </div>

            {/* Navigation */}
            <nav className="flex-1 px-2 py-4 space-y-1">
                {navigationItems.map((item) => (
                    <button
                        key={item.id}
                        onClick={() => onNavigate(item.id)}
                        className={`
                            w-full flex items-center gap-3 px-3 py-2.5 rounded-md
                            text-sm font-medium transition-colors
                            ${
                                activeView === item.id
                                    ? 'bg-primary-600 text-white'
                                    : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800/60'
                            }
                        `}
                    >
                        <i className={`${item.icon} w-5 text-center`} />
                        <span>{item.label}</span>
                    </button>
                ))}
            </nav>

            {/* Footer / User Info */}
            <div className="px-4 py-3 border-t border-gray-800 text-xs text-gray-500">
                <div className="flex items-center gap-2">
                    <i className="fa-solid fa-circle text-green-500 text-xs" />
                    <span>Local Mode</span>
                </div>
            </div>
        </aside>
    );
}
