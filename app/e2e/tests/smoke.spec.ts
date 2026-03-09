import { test, expect } from '@playwright/test';
import { AppPage } from '../pages/AppPage';

/**
 * Smoke tests — verifies core app shell renders and POM selectors are correct.
 *
 * These tests require the Electron app's renderer to be accessible.
 * Run `npm run dev` first, then: npx playwright test
 *
 * All tests are skipped until a local dev server is confirmed running.
 * Remove `test.skip` one at a time as you wire up the test environment.
 */

test.describe('Smoke: App shell', () => {
    test.skip('sidebar renders with WhatNext heading', async ({ page }) => {
        await page.goto('/');
        const app = new AppPage(page);
        await expect(app.sidebar.appTitle).toBeVisible();
    });

    test.skip('sidebar Playlists nav item is present', async ({ page }) => {
        await page.goto('/');
        const app = new AppPage(page);
        await expect(app.sidebar.navPlaylists).toBeVisible();
    });

    test.skip('sidebar Library nav item is present', async ({ page }) => {
        await page.goto('/');
        const app = new AppPage(page);
        await expect(app.sidebar.navLibrary).toBeVisible();
    });
});

test.describe('Smoke: Onboarding', () => {
    test.skip('welcome modal appears on first launch', async ({ page }) => {
        await page.goto('/');
        const app = new AppPage(page);
        await expect(app.onboarding.heading).toBeVisible();
        await expect(app.onboarding.displayNameInput).toBeVisible();
    });

    test.skip('completing onboarding dismisses the modal', async ({ page }) => {
        await page.goto('/');
        const app = new AppPage(page);
        await app.onboarding.completeOnboarding('Test User');
        await expect(app.onboarding.heading).not.toBeVisible();
    });
});

test.describe('Smoke: Playlist flow', () => {
    test.skip('Create Playlist button opens the dialog', async ({ page }) => {
        await page.goto('/');
        const app = new AppPage(page);

        // Navigate to playlists view first
        await app.sidebar.navigateTo('playlists');
        await app.playlist.clickCreatePlaylist();
        await expect(app.createPlaylistDialog.dialog).toBeVisible();
        await expect(app.createPlaylistDialog.nameInput).toBeVisible();
    });
});
