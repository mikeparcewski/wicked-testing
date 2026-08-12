import { test, expect } from '@playwright/test';
import { clickFor } from './utils';

/**
 * Universal chrome behavior (wicked-web Topbar, consumed from node_modules):
 * theme toggle (#themeBtn) flips data-theme on <html> and persists it in
 * localStorage 'wa-theme' across reloads; the ecosystem dropdown
 * (#projectsBtn / #projectsMenu) opens on click and closes on Escape.
 */
test.describe('universal chrome', () => {
  test('page loads with signature sections and zero page errors', async ({ page }) => {
    const errors: Error[] = [];
    page.on('pageerror', (err) => errors.push(err));

    await page.goto('/');

    await expect(page).toHaveTitle(/no agent grades its own homework/);
    await expect(page.locator('.hero h1')).toBeVisible();
    await expect(page.locator('#cardfig')).toBeVisible();
    await expect(page.locator('#stage')).toBeVisible();
    await expect(page.locator('#fleetGrid')).toBeVisible();
    await expect(page.locator('.ledger-tree')).toBeVisible();
    await expect(page.locator('.closer h2')).toBeVisible();

    expect(errors, `pageerror events: ${errors.map((e) => e.message).join(' | ')}`).toEqual([]);
  });

  test('theme toggle flips data-theme on <html> and persists across reload', async ({ page }) => {
    await page.goto('/');

    const html = page.locator('html');
    const themeBtn = page.locator('#themeBtn');

    // Fresh context: default is light.
    await expect(html).toHaveAttribute('data-theme', 'light');

    // Toggle: dark, and persisted under 'wa-theme'.
    await clickFor(themeBtn, async () => {
      await expect(html).toHaveAttribute('data-theme', 'dark', { timeout: 1_000 });
    });
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem('wa-theme')))
      .toBe('dark');

    // Persists across reload (no-flash init reads localStorage before paint).
    await page.reload();
    await expect(html).toHaveAttribute('data-theme', 'dark');

    // Toggle back: light again, storage follows.
    await clickFor(themeBtn, async () => {
      await expect(html).toHaveAttribute('data-theme', 'light', { timeout: 1_000 });
    });
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem('wa-theme')))
      .toBe('light');
  });

  test('ecosystem dropdown opens on click and closes on Escape', async ({ page }) => {
    await page.goto('/');

    const btn = page.locator('#projectsBtn');
    const menu = page.locator('#projectsMenu');

    // Closed by default.
    await expect(menu).toBeHidden();
    await expect(btn).toHaveAttribute('aria-expanded', 'false');

    // Opens on click, listing the family (7 entries, incl. this product).
    await clickFor(btn, async () => {
      await expect(menu).toBeVisible({ timeout: 1_000 });
    });
    await expect(btn).toHaveAttribute('aria-expanded', 'true');
    await expect(menu.locator('.dropdown-item')).toHaveCount(7);
    await expect(
      menu.locator('.dropdown-item[href="https://wt.wickedagile.com"]'),
    ).toContainText('testing');

    // Escape closes it.
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(btn).toHaveAttribute('aria-expanded', 'false');
  });
});
