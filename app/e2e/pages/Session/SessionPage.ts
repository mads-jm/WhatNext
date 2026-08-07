import type { Page, Locator } from '@playwright/test';

/**
 * SessionPage — mirrors app/src/renderer/components/Session/SessionView.tsx
 *
 * Sub-components and their data-testid attributes:
 *   SessionHeader     → [data-testid="session-header"]
 *   SessionInfoBar    → [data-testid="session-info-bar"]
 *   TurnIndicator     → [data-testid="turn-indicator"]
 *   ParticipantRoster → [data-testid="participant-list"]
 *   SessionTrackList  → [data-testid="session-queue"]  (contains [data-testid="current-track"])
 */
export class SessionPage {
    /** Role-based heading for the session view (if present). */
    readonly heading: Locator;

    // ---- SessionHeader ----
    /** The top header row containing the End Session button and optional sync error. */
    readonly header: Locator;
    /** "End Session" back button inside SessionHeader. */
    readonly endSessionButton: Locator;

    // ---- TurnIndicator ----
    /** Turn-taking banner (only visible in turn_taking queue mode). */
    readonly turnIndicator: Locator;

    // ---- SessionInfoBar ----
    /** Card row showing playlist name, counts, and share button. */
    readonly infoBar: Locator;

    // ---- ParticipantRoster ----
    /** Left-column participant list card. */
    readonly participantList: Locator;

    // ---- SessionTrackList ----
    /** Right-column track queue card. */
    readonly queueList: Locator;
    /** Row of the currently-playing track (only present when a track is playing). */
    readonly currentTrack: Locator;

    constructor(private readonly page: Page) {
        this.heading = page.getByRole('heading', { name: /session/i });

        this.header = page.locator('[data-testid="session-header"]');
        this.endSessionButton = page.getByRole('button', {
            name: /end session/i,
        });

        this.turnIndicator = page.locator('[data-testid="turn-indicator"]');

        this.infoBar = page.locator('[data-testid="session-info-bar"]');

        this.participantList = page.locator('[data-testid="participant-list"]');

        this.queueList = page.locator('[data-testid="session-queue"]');
        this.currentTrack = page.locator('[data-testid="current-track"]');
    }
}
