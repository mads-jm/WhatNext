import type { Page, Locator } from '@playwright/test';

/**
 * PlaylistPage — mirrors app/src/renderer/components/Playlist/PlaylistView.tsx
 * and PlaylistList.tsx (the left panel list + right panel detail view).
 */
export class PlaylistPage {
    // Left panel — playlist list
    readonly createPlaylistButton: Locator;
    readonly playlistCards: Locator;

    // Right panel — playlist detail
    readonly playlistTitle: Locator;
    readonly trackList: Locator;
    readonly exportButton: Locator;
    readonly sessionButton: Locator;

    constructor(private readonly page: Page) {
        this.createPlaylistButton = page.getByRole('button', {
            name: /create playlist/i,
        });
        this.playlistCards = page.locator('[data-testid="playlist-card"]');

        this.playlistTitle = page.getByRole('heading', { level: 2 });
        this.trackList = page.locator('[data-testid="track-list"]');
        this.exportButton = page.getByRole('button', { name: /export/i });
        this.sessionButton = page.getByRole('button', {
            name: /start session/i,
        });
    }

    async clickCreatePlaylist() {
        await this.createPlaylistButton.click();
    }

    /** Click a playlist card by name. */
    async selectPlaylist(name: string) {
        await this.page
            .getByRole('button', { name: new RegExp(name, 'i') })
            .click();
    }
}
