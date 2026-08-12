import { test, expect } from '@playwright/test';
import { expectStableFor } from './utils';

/**
 * Reduced motion. The page script checks prefers-reduced-motion and:
 *  - removes .is-playing from the wall stage (no chip animation),
 *  - never starts the fleet auto-cycle (the "all" tab stays selected).
 * The page must load cleanly (zero pageerror) with every key section
 * visible and static.
 */
test.use({ contextOptions: { reducedMotion: 'reduce' } });

test.describe('reduced motion', () => {
  test('page loads without errors; autoplay is off; key sections visible', async ({ page }) => {
    const errors: Error[] = [];
    page.on('pageerror', (err) => errors.push(err));

    await page.goto('/');

    // Key sections all render.
    await expect(page.locator('.hero h1')).toBeVisible();
    await expect(page.locator('#cardfig')).toBeVisible();
    await expect(page.locator('#stage')).toBeVisible();
    await expect(page.locator('#fleetGrid')).toBeVisible();
    await expect(page.locator('.ledger-tree')).toBeVisible();
    await expect(page.locator('.closer h2')).toBeVisible();

    // The wall stage does not play under reduced motion.
    await expect(page.locator('#stage')).not.toHaveClass(/is-playing/);

    // The fleet auto-cycle never starts: "all" stays selected past what
    // would be a full 2200ms cycle tick (sticky poll, no fixed sleep).
    const allTab = page.locator('#fleetFilter .f-btn[data-surf="all"]');
    await expect(allTab).toHaveClass(/is-on/);
    await expectStableFor(
      async () => /(^|\s)is-on(\s|$)/.test((await allTab.getAttribute('class')) ?? ''),
      2_600,
    );
    await expect(page.locator('#fleetGrid')).not.toHaveClass(/is-filtered/);

    expect(errors, `pageerror events: ${errors.map((e) => e.message).join(' | ')}`).toEqual([]);
  });
});
