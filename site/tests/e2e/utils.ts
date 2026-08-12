import { expect, type Locator } from '@playwright/test';

/**
 * Click `target` and retry the click until `effect` passes.
 *
 * The page uses scroll-snap-type: y mandatory on desktop, which fights
 * scrollIntoViewIfNeeded's minimal scroll (the snap can bounce the viewport
 * back, and the click's actionability re-scroll loops forever). Instead,
 * scroll the target to the viewport center — every top-level section fits
 * the viewport, so the snap settles with the section (and the target) fully
 * visible — wait for the snap to settle, then click. The widgets also run
 * setInterval autoplay that mutates layout, so the click + expected effect
 * are retried as a unit. No fixed sleeps anywhere.
 */
export async function clickFor(
  target: Locator,
  effect: () => Promise<void>,
  timeout = 15_000,
): Promise<void> {
  await target.evaluate((el) =>
    el.scrollIntoView({ block: 'center', behavior: 'instant' as ScrollBehavior }),
  );
  // Wait until the scroll (incl. any snap adjustment) has settled: two
  // consecutive samples of window.scrollY must match.
  let last = -1;
  await expect
    .poll(
      async () => {
        const y = await target.page().evaluate(() => window.scrollY);
        const settled = y === last;
        last = y;
        return settled;
      },
      { intervals: [100], timeout: 5_000 },
    )
    .toBe(true);
  await expect(async () => {
    await target.click({ timeout: 2_500 });
    await effect();
  }).toPass({ timeout });
}

/**
 * Assert that `check` stays true for at least `holdMs` milliseconds.
 *
 * Used to verify stop-on-interaction for setInterval-driven autoplay
 * (fleet auto-cycle ticks every 2200ms): once the user clicks, the
 * selection must remain stable across more than one full tick. Polls
 * instead of sleeping; the result is sticky — a single observed flip
 * fails the assertion even if state flips back later.
 */
export async function expectStableFor(
  check: () => Promise<boolean>,
  holdMs: number,
  timeout = 20_000,
): Promise<void> {
  const start = Date.now();
  let broke = false;
  await expect
    .poll(
      async () => {
        if (!broke && !(await check())) broke = true;
        if (broke) return 'state-changed';
        return Date.now() - start >= holdMs ? 'stable' : 'waiting';
      },
      {
        intervals: [250],
        timeout,
        message: `state must stay put for ${holdMs}ms (autoplay stopped on interaction)`,
      },
    )
    .toBe('stable');
}
