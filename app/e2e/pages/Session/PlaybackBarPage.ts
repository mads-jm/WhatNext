import type { Page, Locator } from '@playwright/test';

/**
 * PlaybackBarPage — mirrors app/src/renderer/components/Session/PlaybackBar.tsx
 */
export class PlaybackBarPage {
    readonly root: Locator;
    readonly playPauseButton: Locator;
    readonly trackTitle: Locator;
    readonly artistName: Locator;
    readonly progressBar: Locator;

    constructor(private readonly page: Page) {
        this.root = page.locator('[data-testid="playback-bar"]');
        this.playPauseButton = this.root.getByRole('button', { name: /play|pause/i });
        this.trackTitle = this.root.locator('[data-testid="track-title"]');
        this.artistName = this.root.locator('[data-testid="artist-name"]');
        this.progressBar = this.root.getByRole('progressbar');
    }
}
