import { test, expect } from '@playwright/test';
import { clickFor, expectStableFor } from './utils';

/**
 * Fleet filter tabs (#fleetFilter, buttons carrying [data-surf]).
 * The page auto-cycles through the five surfaces on a 2200ms setInterval
 * until the user clicks a tab; a click stops the cycle and applies the
 * chosen surface: the tab gets .is-on + aria-selected, the grid gets
 * .is-filtered, and matching .agent cards get .is-match.
 */
test.describe('fleet tabs', () => {
  test('clicking a surface tab filters the roster and stops the auto-cycle', async ({ page }) => {
    await page.goto('/');

    const filter = page.locator('#fleetFilter');
    const grid = page.locator('#fleetGrid');
    const reviewTab = filter.locator('.f-btn[data-surf="review"]');

    // The full roster is present regardless of filter state.
    await expect(grid.locator('.agent')).toHaveCount(40);

    // Click the review tab — retried until the selection takes effect
    // (the click also races the auto-cycle's apply()).
    await clickFor(reviewTab, async () => {
      await expect(reviewTab).toHaveClass(/is-on/, { timeout: 1_000 });
    });
    await expect(reviewTab).toHaveAttribute('aria-selected', 'true');
    await expect(grid).toHaveClass(/is-filtered/);

    // Exactly the six review specialists match — no cross-surface leakage.
    await expect(grid.locator('.agent.is-match')).toHaveCount(6);
    await expect(grid.locator('.agent.is-match[data-surf="review"]')).toHaveCount(6);

    // Stop-on-interaction: the auto-cycle ticks every 2200ms; after the
    // click the selection must hold past a full tick. A single observed
    // flip fails this (sticky check — no "nothing changed" blind spot).
    await expectStableFor(
      async () =>
        (await reviewTab.getAttribute('aria-selected')) === 'true' &&
        /(^|\s)is-on(\s|$)/.test((await reviewTab.getAttribute('class')) ?? ''),
      2_600,
    );

    // Back to "all": filter clears entirely.
    const allTab = filter.locator('.f-btn[data-surf="all"]');
    await clickFor(allTab, async () => {
      await expect(allTab).toHaveClass(/is-on/, { timeout: 1_000 });
    });
    await expect(grid).not.toHaveClass(/is-filtered/);
    await expect(grid.locator('.agent.is-match')).toHaveCount(0);
  });

  test('each surface tab badge matches the number of filtered skills', async ({ page }) => {
    await page.goto('/');

    const filter = page.locator('#fleetFilter');
    const grid = page.locator('#fleetGrid');

    for (const [surf, count] of [
      ['plan', 7],
      ['execution', 14],
    ] as const) {
      const tab = filter.locator(`.f-btn[data-surf="${surf}"]`);
      await expect(tab.locator('.f-n')).toHaveText(String(count));
      await clickFor(tab, async () => {
        await expect(tab).toHaveClass(/is-on/, { timeout: 1_000 });
      });
      await expect(grid.locator('.agent.is-match')).toHaveCount(count);
      await expect(grid.locator(`.agent.is-match[data-surf="${surf}"]`)).toHaveCount(count);
    }
  });
});
