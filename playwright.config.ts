import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  outputDir: './tests/e2e/results',
  fullyParallel: false,
  retries: 1,
  timeout: 15_000,

  use: {
    baseURL: 'http://localhost:8000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'on-first-retry',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  webServer: {
    command: 'bun run dev',
    url: 'http://localhost:8000/demo/',
    reuseExistingServer: true,
    timeout: 15_000,
  },

  reporter: [['html', { outputFolder: 'tests/e2e/report', open: 'never' }], ['list']],
});
