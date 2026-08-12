import { test, expect, devices } from '@playwright/test';
import { clickFor } from './utils';

/**
 * Mobile fallbacks (iPhone 12, 390x844). Documented in testing.css and the
 * Topbar chrome:
 *  - <=820px: the wall + chip channel are display:none; the stage stacks.
 *  - <=760px: scroll-snap is disabled (free scroll).
 *  - <=640px: inline nav icons collapse behind a hamburger (#menuBtn);
 *    the theme toggle stays inline.
 *  - <=560px: the "/ wicked-testing" pkg label hides.
 *  - The .wrap width fixes must prevent horizontal page overflow.
 * Widgets must remain usable, not broken.
 */
// iPhone 12 emulation (390x844) run in Chromium: spreading the whole device
// descriptor would pull in defaultBrowserType: 'webkit', which this suite
// does not install — so pick the emulation fields explicitly.
const iphone12 = devices['iPhone 12'];
test.use({
  viewport: iphone12.viewport,
  userAgent: iphone12.userAgent,
  deviceScaleFactor: iphone12.deviceScaleFactor,
  isMobile: iphone12.isMobile,
  hasTouch: iphone12.hasTouch,
});

test.describe('mobile fallbacks', () => {
  test('wall animation is replaced by a stacked stage; no horizontal overflow', async ({ page }) => {
    const errors: Error[] = [];
    page.on('pageerror', (err) => errors.push(err));

    await page.goto('/');

    // The animated wall + evidence channel are hidden on phones...
    await expect(page.locator('#stage .wall')).toBeHidden();
    await expect(page.locator('#stage .channel')).toBeHidden();

    // ...but all three role cards still render.
    for (const role of ['0', '1', '2']) {
      await expect(page.locator(`.role[data-role="${role}"]`)).toBeVisible();
    }
    // Stacked, not side-by-side: executor sits below writer.
    const writerBox = await page.locator('.role[data-role="0"]').boundingBox();
    const executorBox = await page.locator('.role[data-role="1"]').boundingBox();
    expect(writerBox && executorBox && executorBox.y > writerBox.y + writerBox.height - 1).toBe(true);

    // Scroll-snap falls back to free scroll on phones.
    expect(
      await page.evaluate(() => getComputedStyle(document.documentElement).scrollSnapType),
    ).toBe('none');

    // The documented .wrap overflow fixes hold: no horizontal page scroll.
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        ),
      )
      .toBeLessThanOrEqual(1);

    expect(errors, `pageerror events: ${errors.map((e) => e.message).join(' | ')}`).toEqual([]);
  });

  test('topbar collapses to hamburger; mobile menu opens; theme toggle stays inline', async ({ page }) => {
    await page.goto('/');

    // Inline ecosystem/Medium/GitHub icons collapse; hamburger appears.
    await expect(page.locator('#projectsBtn')).toBeHidden();
    await expect(page.locator('#menuBtn')).toBeVisible();
    // The pkg label hides at <=560px.
    await expect(page.locator('.topbar-pkg')).toBeHidden();

    // Hamburger opens the mobile menu with the full family list.
    const menuBtn = page.locator('#menuBtn');
    const mobileMenu = page.locator('#mobileMenu');
    await expect(mobileMenu).toBeHidden();
    await clickFor(menuBtn, async () => {
      await expect(mobileMenu).toBeVisible({ timeout: 1_000 });
    });
    await expect(menuBtn).toHaveAttribute('aria-expanded', 'true');
    await expect(mobileMenu.locator('.mm-item')).toHaveCount(9);
    await page.keyboard.press('Escape');
    await expect(mobileMenu).toBeHidden();

    // Theme toggle remains inline and functional on mobile.
    const html = page.locator('html');
    await expect(html).toHaveAttribute('data-theme', 'light');
    await clickFor(page.locator('#themeBtn'), async () => {
      await expect(html).toHaveAttribute('data-theme', 'dark', { timeout: 1_000 });
    });
  });

  test('signature widgets stay usable on a phone', async ({ page }) => {
    await page.goto('/');

    // Reveal-reviewer still flips.
    const fig = page.locator('#cardfig');
    await clickFor(fig.locator('[data-reveal]'), async () => {
      await expect(fig).toHaveAttribute('data-revealed', 'true', { timeout: 1_000 });
    });
    await expect(fig.locator('[data-revmark]')).toHaveText('FAIL');

    // Fleet filter still filters.
    const grid = page.locator('#fleetGrid');
    const executionTab = page.locator('#fleetFilter .f-btn[data-surf="execution"]');
    await clickFor(executionTab, async () => {
      await expect(executionTab).toHaveClass(/is-on/, { timeout: 1_000 });
    });
    await expect(grid.locator('.agent.is-match')).toHaveCount(14);
  });
});
