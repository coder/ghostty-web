/**
 * Chromium tests for canvas pixels, fonts, DPR and trusted input (tests/browser).
 * `.pw.ts` keeps these specs out of `bun test` discovery.
 */
import { defineConfig } from '@playwright/test';

const port = Number(process.env.PLAYWRIGHT_PORT ?? 4173);
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: './tests/browser',
  testMatch: '**/*.pw.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  outputDir: 'test-results/browser',
  reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
  use: {
    baseURL,
    browserName: 'chromium',
    viewport: { width: 1000, height: 700 },
    locale: 'en-US',
    timezoneId: 'UTC',
    colorScheme: 'dark',
    reducedMotion: 'reduce',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    launchOptions: {
      // Opt-in for local diagnosis only; CI uses Playwright's pinned browser.
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    },
  },
  webServer: {
    command: `bunx --no-install vite --host 127.0.0.1 --port ${port} --strictPort`,
    url: `${baseURL}/tests/browser/harness.html`,
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
