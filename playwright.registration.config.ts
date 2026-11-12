import { defineConfig, devices } from '@playwright/test';
const port = Number(process.env.PLAYWRIGHT_REGISTRATION_PORT || 3163);
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error('Use a valid test port.');
export default defineConfig({
  testDir: './tests/registration-browser',
  outputDir: './test-results/registration-browser',
  workers: 1,
  retries: 0,
  use: {
    baseURL: `http://127.0.0.1:${port}`,
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
    url: `http://127.0.0.1:${port}/login`,
    reuseExistingServer: false,
    // Synthetic configuration renders the real login form; browser requests are intercepted below.
    // Loopback port 1 guarantees these tests cannot reach a private hosted database.
    env: {
      NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:1',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'test-public-key',
      SUPABASE_SERVICE_ROLE_KEY: 'test-server-key',
      OWNER_EMAIL: 'owner@example.test',
      BETA_REGISTRATION_MODE: 'preauthorized',
      BETA_SITE_URL: '',
      OPENAI_API_KEY: '',
    },
  },
});
