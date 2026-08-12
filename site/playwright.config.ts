import { defineConfig, devices } from '@playwright/test';
const PORT = Number(process.env.E2E_PORT ?? 4335);
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  // Every page runs infinite CSS animations (evidence chips) plus scroll-snap,
  // so unbounded workers on a busy machine starve the render loop and time
  // tests out. Four workers keeps the suite well under a minute and stable.
  workers: process.env.CI ? 2 : 4,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: { baseURL: `http://127.0.0.1:${PORT}`, trace: 'on-first-retry' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // --host 127.0.0.1: astro preview otherwise binds localhost (IPv6 ::1
    // first on macOS), which never answers the 127.0.0.1 baseURL.
    command: `npm run preview -- --port ${PORT} --host 127.0.0.1`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    // Astro >=7 daemonizes `preview` when it detects an agentic environment
    // (am-i-vibing), so the spawned process exits immediately and Playwright
    // reports "Process from config.webServer exited early". Setting this env
    // var forces the foreground code path (it is the marker the daemon child
    // uses internally); harmless in CI, where no agent is detected anyway.
    env: { ASTRO_PREVIEW_BACKGROUND: '1' },
  },
});
