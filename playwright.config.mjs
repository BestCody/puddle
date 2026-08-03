import { defineConfig, devices } from '@playwright/test'

const baseURL = process.env.E2E_BASE_URL || 'http://localhost:3000'
const r2BaseURL = process.env.E2E_R2_BASE_URL || 'http://127.0.0.1:43110'
const serverCommand = process.env.CI
  ? 'npm run build && npm run start -- --hostname localhost'
  : 'npm run dev -- --hostname localhost'
const runtimeEnv = {
  ...process.env,
  E2E_DIAGNOSTICS: 'true',
  PUDDLE_LEGACY_SYSTEMS_ENABLED: 'false',
  STATIC_CATALOGUE_BASE_URL: r2BaseURL,
  NEXT_PUBLIC_CATALOGUE_ASSET_BASE_URL: r2BaseURL,
  STATIC_CATALOGUE_ALLOW_INSECURE_LOCALHOST: 'true',
  STATIC_CATALOGUE_ACTION_SECRET: process.env.STATIC_CATALOGUE_ACTION_SECRET || 'puddle-e2e-static-reference-secret-2026',
  STATIC_CATALOGUE_MAX_TILES: '16',
  STATIC_CATALOGUE_DISCOVERY_LIMIT: '144',
  NEXT_PUBLIC_GOOGLE_PLACES_UI_KIT_ENABLED: 'true',
  NEXT_PUBLIC_GOOGLE_MAPS_API_KEY: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || 'e2e-google-browser-key'
}

export default defineConfig({
  testDir: './tests/e2e',
  testIgnore: ['**/*.test.mjs'],
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
  webServer: [
    {
      command: 'node tests/e2e/r2-fixture-server.mjs',
      url: `${r2BaseURL}/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
      stdout: 'pipe',
      stderr: 'pipe',
      env: runtimeEnv
    },
    {
      command: serverCommand,
      url: `${baseURL}/signin`,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
      stdout: 'pipe',
      stderr: 'pipe',
      env: runtimeEnv
    }
  ]
})
