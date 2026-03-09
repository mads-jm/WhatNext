import type { Page, Locator } from '@playwright/test';

/**
 * TrackPickerModal — mirrors app/src/renderer/components/Playlist/TrackPickerModal.tsx
 */
export class TrackPickerModal {
    readonly modal: Locator;
    readonly searchInput: Locator;
    readonly trackCheckboxes: Locator;
    readonly addButton: Locator;
    readonly cancelButton: Locator;

    constructor(private readonly page: Page) {
        this.modal = page.getByRole('dialog');
        this.searchInput = this.modal.getByPlaceholder(/search/i);
        this.trackCheckboxes = this.modal.getByRole('checkbox');
        this.addButton = this.modal.getByRole('button', { name: /add/i });
        this.cancelButton = this.modal.getByRole('button', { name: /cancel/i });
    }

    async searchFor(query: string) {
        await this.searchInput.fill(query);
    }

    async selectTrack(title: string) {
        await this.modal.getByRole('checkbox', { name: new RegExp(title, 'i') }).check();
    }

    async confirm() {
        await this.addButton.click();
    }
}
