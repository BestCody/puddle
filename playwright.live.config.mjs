import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests/live',
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  retries: 0,
  reporter: [['line']],
  use: {
    baseURL: process.env.LIVE_BASE_URL || 'https://puddle.you',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure'
  },
  projects: [
    { name: 'live-chromium', use: { ...devices['Desktop Chrome'] } }
  ]
})
