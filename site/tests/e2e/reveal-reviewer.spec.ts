import { test, expect } from '@playwright/test';
import { clickFor } from './utils';

/**
 * Reveal-reviewer widget (gap band, #cardfig).
 * Clicking [data-reveal] flips data-revealed on the figure, swaps the
 * reviewer verdict PASS -> FAIL, updates the sub-line, and turns the
 * button into a reset control. Clicking again restores the initial state.
 */
test.describe('reveal-reviewer widget', () => {
  test('clicking the reveal button flips the verdict display and resets', async ({ page }) => {
    await page.goto('/');

    const fig = page.locator('#cardfig');
    const btn = fig.locator('[data-reveal]');
    const mark = fig.locator('[data-revmark]');
    const sub = fig.locator('[data-revsub]');

    // Initial state: unrevealed, reviewer verdict still shows PASS.
    await expect(fig).toHaveAttribute('data-revealed', 'false');
    await expect(btn).toHaveAttribute('aria-pressed', 'false');
    await expect(btn).toHaveText('Send it to an independent reviewer →');
    await expect(mark).toHaveText('PASS');
    await expect(sub).toHaveText('awaiting review…');

    // Reveal: verdict flips to FAIL.
    await clickFor(btn, async () => {
      await expect(fig).toHaveAttribute('data-revealed', 'true', { timeout: 1_000 });
    });
    await expect(btn).toHaveAttribute('aria-pressed', 'true');
    await expect(mark).toHaveText('FAIL');
    await expect(sub).toHaveText('caught a real bug');
    await expect(btn).toHaveText('↺ Reset');

    // Reset: back to the initial state.
    await clickFor(btn, async () => {
      await expect(fig).toHaveAttribute('data-revealed', 'false', { timeout: 1_000 });
    });
    await expect(btn).toHaveAttribute('aria-pressed', 'false');
    await expect(mark).toHaveText('PASS');
    await expect(sub).toHaveText('awaiting review…');
    await expect(btn).toHaveText('Send it to an independent reviewer →');
  });
});
