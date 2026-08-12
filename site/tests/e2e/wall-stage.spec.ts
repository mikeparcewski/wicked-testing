import { test, expect } from '@playwright/test';
import { clickFor } from './utils';

/**
 * The wall stage (#stage) — the live evidence-handoff band.
 * On load (without reduced motion) the stage plays its chip animation
 * (.is-playing) and the Reviewer role is lit. Clicking a role moves the
 * .is-lit highlight to that role exclusively.
 */
test.describe('wall stage', () => {
  test('plays on load and clicking a role moves the highlight', async ({ page }) => {
    await page.goto('/');

    const stage = page.locator('#stage');
    const writer = stage.locator('.role[data-role="0"]');
    const executor = stage.locator('.role[data-role="1"]');
    const reviewer = stage.locator('.role[data-role="2"]');

    // Initial state: playing, Reviewer lit.
    await expect(stage).toHaveClass(/is-playing/);
    await expect(reviewer).toHaveClass(/is-lit/);

    // Click the Executor role: highlight moves there exclusively.
    await clickFor(executor, async () => {
      await expect(executor).toHaveClass(/is-lit/, { timeout: 1_000 });
    });
    await expect(reviewer).not.toHaveClass(/is-lit/);
    await expect(writer).not.toHaveClass(/is-lit/);

    // And again for the Writer.
    await clickFor(writer, async () => {
      await expect(writer).toHaveClass(/is-lit/, { timeout: 1_000 });
    });
    await expect(executor).not.toHaveClass(/is-lit/);
    await expect(reviewer).not.toHaveClass(/is-lit/);
  });
});
