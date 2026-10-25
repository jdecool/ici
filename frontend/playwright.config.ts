import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  forbidOnly: true,
  retries: 0,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: process.env['BASE_URL'] ?? 'http://ici.localhost:8080',
    launchOptions: {
      args: process.env['E2E_WEB_IP']
        ? [
            `--host-resolver-rules=MAP ici.localhost ${process.env['E2E_WEB_IP']}, MAP *.ici.localhost ${process.env['E2E_WEB_IP']}`,
          ]
        : [],
    },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
