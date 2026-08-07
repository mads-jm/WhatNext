import type { Page, Locator } from '@playwright/test';

/**
 * ReactionBarPage — mirrors Social/ReactionBar.tsx and ReactionButton.tsx
 */
export class ReactionBarPage {
    readonly reactionButtons: Locator;

    constructor(private readonly page: Page) {
        this.reactionButtons = page.locator('[data-testid="reaction-button"]');
    }

    /** Click a specific reaction emoji button. */
    async react(
        emoji:
            | 'fire'
            | 'heart'
            | 'thumbsdown'
            | 'mindblown'
            | 'sleeping'
            | 'party',
    ) {
        await this.page
            .getByRole('button', { name: new RegExp(emoji, 'i') })
            .click();
    }
}
