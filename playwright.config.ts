import { defineConfig, devices } from '@playwright/test';

if (process.env.ATLAS_E2E_DISPOSABLE !== '1' || !process.env.DATABASE_URL) {
  throw new Error(
    'Playwright E2E requires ATLAS_E2E_DISPOSABLE=1 and a disposable PostGIS DATABASE_URL.',
  );
}

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 45_000,
  expect: { timeout: 10_000 },
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:5173', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'node apps/api/dist/server.js',
      url: 'http://127.0.0.1:3001/health',
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: 'pnpm --filter @travel-atlas/web dev',
      url: 'http://127.0.0.1:5173',
      reuseExistingServer: false,
      timeout: 30_000,
    },
  ],
});
