import type { Page, Locator } from '@playwright/test';

/**
 * SpotifyImportPage — mirrors Spotify/SpotifyImport.tsx and related sub-components:
 *   SpotifyAuthGate → SpotifyPlaylistBrowser → SpotifyTrackSelector → SpotifyImportComplete
 */
export class SpotifyImportPage {
    // Auth gate
    readonly connectButton: Locator;

    // Playlist browser
    readonly playlistItems: Locator;

    // Track selector
    readonly trackCheckboxes: Locator;
    readonly selectAllButton: Locator;
    readonly importButton: Locator;

    // Completion
    readonly successMessage: Locator;

    constructor(private readonly page: Page) {
        this.connectButton = page.getByRole('button', { name: /connect.*spotify/i });

        this.playlistItems = page.locator('[data-testid="spotify-playlist-item"]');

        this.trackCheckboxes = page.getByRole('checkbox');
        this.selectAllButton = page.getByRole('button', { name: /select all/i });
        this.importButton = page.getByRole('button', { name: /import/i });

        this.successMessage = page.getByText(/import(ed|ing)?.*complete|success/i);
    }

    async selectPlaylist(name: string) {
        await this.page.getByRole('button', { name: new RegExp(name, 'i') }).click();
    }
}
