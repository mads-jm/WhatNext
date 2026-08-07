import type { Page, Locator } from '@playwright/test';

/**
 * SessionSetupPage — mirrors app/src/renderer/components/Session/SessionSetup.tsx
 *
 * The setup wizard has two track-source modes:
 *   - Spotify Collaborative Playlist (radio)
 *   - Manual / metadata only (radio)
 * And a participants list with checkboxes.
 */
export class SessionSetupPage {
    readonly heading: Locator;

    // Track source
    readonly spotifyRadio: Locator;
    readonly manualRadio: Locator;

    // Participant management
    readonly participantNameInput: Locator;
    readonly participantSpotifyInput: Locator;
    readonly addParticipantButton: Locator;
    readonly participantCheckboxes: Locator;

    // Wizard actions
    readonly startSessionButton: Locator;
    readonly cancelButton: Locator;

    constructor(private readonly page: Page) {
        this.heading = page.getByRole('heading', { name: /session/i });

        this.spotifyRadio = page.getByRole('radio', {
            name: /spotify collaborative/i,
        });
        this.manualRadio = page.getByRole('radio', { name: /manual/i });

        this.participantNameInput = page.getByLabel(/display name/i);
        this.participantSpotifyInput = page.getByLabel(/spotify/i);
        this.addParticipantButton = page.getByRole('button', { name: /add/i });
        this.participantCheckboxes = page.getByRole('checkbox');

        this.startSessionButton = page.getByRole('button', {
            name: /start session/i,
        });
        this.cancelButton = page.getByRole('button', { name: /cancel/i });
    }

    async selectTrackSource(mode: 'spotify' | 'manual') {
        if (mode === 'spotify') {
            await this.spotifyRadio.click();
        } else {
            await this.manualRadio.click();
        }
    }
}
