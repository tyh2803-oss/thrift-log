import { defineConfig, devices } from '@playwright/test';
const port = Number(process.env.PLAYWRIGHT_HISTORY_PORT || 3181),
  authPort = port + 1;
if (!Number.isInteger(port) || port < 1024 || authPort > 65535)
  throw new Error('Use a valid test port.');
export default defineConfig({
  testDir: './tests/history-browser',
  outputDir: './test-results/history',
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
  webServer: [
    {
      command: 'node tests/helpers/tester-auth-server.mjs',
      url: `http://127.0.0.1:${authPort}/__health`,
      env: { TESTER_AUTH_PORT: String(authPort), HISTORY_BROWSER_WRITES: '1' },
      reuseExistingServer: false,
    },
    {
      command: `npm run start -- --port ${port} --hostname 127.0.0.1`,
      url: `http://127.0.0.1:${port}/login`,
      reuseExistingServer: false,
      env: {
        NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${authPort}`,
        NEXT_PUBLIC_SUPABASE_ANON_KEY: 'test-public-key',
        SUPABASE_SERVICE_ROLE_KEY: 'test-server-key',
        OWNER_EMAIL: 'owner@example.test',
        BETA_REGISTRATION_MODE: 'preauthorized',
        BETA_SITE_URL: '',
        OPENAI_API_KEY: '',
        VERCEL: '',
      },
    },
  ],
});
