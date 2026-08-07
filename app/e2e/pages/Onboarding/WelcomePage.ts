import type { Page, Locator } from '@playwright/test';

/**
 * WelcomePage — mirrors app/src/renderer/components/Onboarding/WelcomeModal.tsx
 *
 * Shown on first launch via ModalPortal. Contains a display-name input
 * and a "Get Started" / save button.
 */
export class WelcomePage {
    readonly modal: Locator;
    readonly heading: Locator;
    readonly displayNameInput: Locator;
    readonly getStartedButton: Locator;
    readonly skipButton: Locator;

    constructor(private readonly page: Page) {
        // The modal is rendered into a portal, so query from page root.
        this.modal = page.locator(
            '.bg-gray-900.border.border-gray-700.rounded-xl',
        );
        this.heading = page.getByRole('heading', {
            name: /welcome to whatnext/i,
        });
        this.displayNameInput = page.getByPlaceholder(/your display name/i);
        this.getStartedButton = page.getByRole('button', {
            name: /get started|save|continue/i,
        });
        this.skipButton = page.getByRole('button', { name: /skip/i });
    }

    get isVisible() {
        return this.heading.isVisible();
    }

    async completeOnboarding(displayName: string) {
        await this.displayNameInput.fill(displayName);
        await this.getStartedButton.click();
    }

    async skip() {
        await this.skipButton.click();
    }
}
