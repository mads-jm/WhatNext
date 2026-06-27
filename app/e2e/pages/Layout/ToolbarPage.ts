import type { Page, Locator } from '@playwright/test';

/**
 * ToolbarPage — mirrors app/src/renderer/components/Layout/Toolbar.tsx
 */
export class ToolbarPage {
    readonly root: Locator;

    constructor(private readonly page: Page) {
        this.root = page.locator('[class*="toolbar"], header').first();
    }
}
