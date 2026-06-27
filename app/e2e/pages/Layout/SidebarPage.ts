import type { Page, Locator } from '@playwright/test';

/**
 * SidebarPage — mirrors app/src/renderer/components/Layout/Sidebar.tsx
 *
 * The sidebar uses collapsible section groups. Navigation items are <button>
 * elements with visible text labels from the `navigationItems` config.
 */
export class SidebarPage {
    // App identity
    readonly appTitle: Locator;

    // Workspace section children
    readonly navPlaylists: Locator;
    readonly navLibrary: Locator;
    readonly navSessions: Locator;
    readonly navSpotifyImport: Locator;

    // P2P section children
    readonly navNetworkStatus: Locator;

    // Settings section children
    readonly navSettingsGeneral: Locator;

    // Identity bar (bottom)
    readonly identityBar: Locator;
    readonly copyConnectionLink: Locator;

    constructor(private readonly page: Page) {
        this.appTitle = page.getByRole('heading', { name: 'WhatNext', level: 1 });

        this.navPlaylists = page.getByRole('button', { name: /^Playlists$/i });
        this.navLibrary = page.getByRole('button', { name: /^Library$/i });
        this.navSessions = page.getByRole('button', { name: /^Sessions$/i });
        this.navSpotifyImport = page.getByRole('button', { name: /^Spotify Import$/i });

        this.navNetworkStatus = page.getByRole('button', { name: /^Network Status$/i });

        this.navSettingsGeneral = page.getByRole('button', { name: /^General$/i });

        this.identityBar = page.locator('.sidebar').getByRole('button').last();
        this.copyConnectionLink = page.getByTitle('Copy connection link');
    }

    async navigateTo(section: 'playlists' | 'library' | 'sessions' | 'spotify' | 'network' | 'settings') {
        const map: Record<string, Locator> = {
            playlists: this.navPlaylists,
            library: this.navLibrary,
            sessions: this.navSessions,
            spotify: this.navSpotifyImport,
            network: this.navNetworkStatus,
            settings: this.navSettingsGeneral,
        };
        await map[section].click();
    }
}
