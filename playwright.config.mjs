import { defineConfig, devices } from '@playwright/test'

const baseURL = process.env.E2E_BASE_URL || 'http://127.0.0.1:3000'
const serverCommand = process.env.CI
  ? 'npm run build && npm run start -- --hostname 127.0.0.1'
  : 'npm run dev -- --hostname 127.0.0.1'

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 75_000,
  expect: { timeout: 12_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI
    ? [['line'], ['html', { outputFolder: 'playwright-report', open: 'never' }]]
    : [['list']],
  use: {
    baseURL,
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure'
  },
  projects: [
    {
      name: 'desktop-chromium',
      use: { ...devices['Desktop Chrome'] }
    },
    {
      name: 'mobile-chromium',
      testMatch: /public-routes\.spec\.mjs/,
      use: { ...devices['Pixel 5'] }
    }
  ],
  webServer: {
    command: serverCommand,
    url: `${baseURL}/signin`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: 'pipe',
    stderr: 'pipe'
  }
})
