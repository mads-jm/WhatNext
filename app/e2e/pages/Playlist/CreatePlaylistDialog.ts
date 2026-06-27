import type { Page, Locator } from '@playwright/test';

/**
 * CreatePlaylistDialog — mirrors app/src/renderer/components/Playlist/CreatePlaylistDialog.tsx
 */
export class CreatePlaylistDialog {
    readonly dialog: Locator;
    readonly nameInput: Locator;
    readonly descriptionInput: Locator;
    readonly tagsInput: Locator;
    readonly collaborativeCheckbox: Locator;
    readonly submitButton: Locator;
    readonly cancelButton: Locator;

    constructor(private readonly page: Page) {
        this.dialog = page.getByRole('dialog');
        this.nameInput = this.dialog.getByLabel(/name/i);
        this.descriptionInput = this.dialog.getByLabel(/description/i);
        this.tagsInput = this.dialog.getByLabel(/tags/i);
        this.collaborativeCheckbox = this.dialog.getByRole('checkbox', { name: /collaborative/i });
        this.submitButton = this.dialog.getByRole('button', { name: /create/i });
        this.cancelButton = this.dialog.getByRole('button', { name: /cancel/i });
    }

    async fill(name: string, description?: string) {
        await this.nameInput.fill(name);
        if (description) await this.descriptionInput.fill(description);
    }

    async submit() {
        await this.submitButton.click();
    }

    async cancel() {
        await this.cancelButton.click();
    }
}
