import type { Page, Locator } from '@playwright/test';

/**
 * SettingsPage — mirrors app/src/renderer/components/Settings/ProfileSettings.tsx
 */
export class SettingsPage {
    readonly heading: Locator;
    readonly displayNameInput: Locator;
    readonly avatarUrlInput: Locator;
    readonly saveButton: Locator;

    constructor(private readonly page: Page) {
        this.heading = page.getByRole('heading', { name: /settings|profile/i });
        this.displayNameInput = page.getByLabel(/display name/i);
        this.avatarUrlInput = page.getByLabel(/avatar/i);
        this.saveButton = page.getByRole('button', { name: /save/i });
    }

    async updateDisplayName(name: string) {
        await this.displayNameInput.fill(name);
        await this.saveButton.click();
    }
}
