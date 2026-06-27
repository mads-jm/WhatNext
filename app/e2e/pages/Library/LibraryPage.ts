import type { Page, Locator } from '@playwright/test';

/**
 * LibraryPage — mirrors app/src/renderer/components/Library/LibraryView.tsx
 */
export class LibraryPage {
    readonly heading: Locator;
    readonly searchInput: Locator;
    readonly trackRows: Locator;
    readonly emptyState: Locator;

    constructor(private readonly page: Page) {
        this.heading = page.getByRole('heading', { name: /library/i });
        this.searchInput = page.getByRole('searchbox').or(page.getByPlaceholder(/search/i));
        this.trackRows = page.locator('[data-testid="track-row"]');
        this.emptyState = page.getByText(/no tracks/i);
    }
}
