import { defineConfig, devices } from '@playwright/test';
const port = Number(process.env.PLAYWRIGHT_PORT || 3000);
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error('Use a valid test port.');
const origin = `http://127.0.0.1:${port}`;
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  use: {
    baseURL: origin,
    trace: 'retain-on-failure',
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || '/usr/bin/chromium',
      args: ['--no-sandbox'],
    },
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium' } },
  ],
  webServer: {
    command: `npm run start -- --port ${port} --hostname 127.0.0.1`,
    url: origin,
    reuseExistingServer: false,
    // Keep browser tests in their own demo server even when real project keys are configured.
    env: {
      NEXT_PUBLIC_SUPABASE_ANON_KEY: '',
      SUPABASE_SERVICE_ROLE_KEY: '',
      OWNER_EMAIL: '',
      BETA_SITE_URL: '',
      OPENAI_API_KEY: '',
    },
    timeout: 120000,
  },
});
