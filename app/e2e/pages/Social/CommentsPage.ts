import type { Page, Locator } from '@playwright/test';

/**
 * CommentsPage — mirrors Social/PlaylistComments.tsx and CommentThread.tsx
 */
export class CommentsPage {
    readonly commentInput: Locator;
    readonly submitButton: Locator;
    readonly commentItems: Locator;

    constructor(private readonly page: Page) {
        this.commentInput = page.getByPlaceholder(/add a comment/i);
        this.submitButton = page.getByRole('button', { name: /post|submit/i });
        this.commentItems = page.locator('[data-testid="comment-item"]');
    }

    async postComment(body: string) {
        await this.commentInput.fill(body);
        await this.submitButton.click();
    }
}
