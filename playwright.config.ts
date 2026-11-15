import { defineConfig, devices } from '@playwright/test';

// Conventions section 7: Chromium at 360x800, selectors by role/label, axe on every screen touched.
// Lives at the repo root (conventions 1: tests/e2e/<epic>.spec.ts). The spec runs against the production build served by `vite preview` (CSP from public/_headers applied).
// Set E2E_REAL_API=1 to hit a running local API instead of the mocked /places responses.
const PORT = 4173;

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 360, height: 800 },
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium-360',
      use: { ...devices['Desktop Chrome'], viewport: { width: 360, height: 800 }, hasTouch: true },
    },
  ],
  webServer: {
    command: 'pnpm --filter ./apps/web build && pnpm --filter ./apps/web preview',
    url: `http://localhost:${PORT}/find`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: { VITE_ENABLE_DEV_ROUTES: 'true' },
  },
});
