import { defineConfig, devices } from '@playwright/test'

const baseURL = process.env.E2E_BASE_URL || 'http://localhost:3000'
const e2eB2AuthorizeEndpoint = String(process.env.E2E_B2_AUTHORIZE_ENDPOINT || process.env.B2_AUTHORIZE_ENDPOINT || '').trim()
const serverCommand = process.env.CI
  ? 'env -u B2_AUTHORIZE_ENDPOINT npm run build && B2_AUTHORIZE_ENDPOINT="$E2E_B2_AUTHORIZE_ENDPOINT" npm run start -- --hostname localhost'
  : 'npm run dev -- --hostname localhost'
const runtimeEnv = {
  ...process.env,
  ...(e2eB2AuthorizeEndpoint ? { B2_AUTHORIZE_ENDPOINT: e2eB2AuthorizeEndpoint } : {}),
  E2E_B2_AUTHORIZE_ENDPOINT: e2eB2AuthorizeEndpoint,
  E2E_DIAGNOSTICS: 'true',
  NEXT_PUBLIC_GOOGLE_PLACES_UI_KIT_ENABLED: 'true',
  NEXT_PUBLIC_GOOGLE_MAPS_API_KEY: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || 'e2e-google-browser-key'
}

if (!e2eB2AuthorizeEndpoint) delete runtimeEnv.B2_AUTHORIZE_ENDPOINT

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
      testMatch: /(responsive-public-routes|authenticated-ui)\.spec\.mjs/,
      use: { ...devices['Pixel 5'] }
    },
  ],
  webServer: {
    command: serverCommand,
    url: `${baseURL}/signin`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: 'pipe',
    stderr: 'pipe',
    env: runtimeEnv
  }
})
