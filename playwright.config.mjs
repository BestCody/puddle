import { defineConfig, devices } from '@playwright/test'

const baseURL = process.env.E2E_BASE_URL || 'http://localhost:3000'
const serverCommand = process.env.CI
  ? 'npm run build && npm run start -- --hostname localhost'
  : 'npm run dev -- --hostname localhost'
const runtimeEnv = {
  ...process.env,
  E2E_DIAGNOSTICS: 'true',
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
      testIgnore: /visual-fidelity\.spec\.mjs/,
      use: { ...devices['Desktop Chrome'] }
    },
    {
      name: 'mobile-chromium',
      testMatch: /(responsive-public-routes|authenticated-ui)\.spec\.mjs/,
      use: { ...devices['Pixel 5'] }
    },
    {
      name: 'figma-desktop',
      testMatch: /visual-fidelity\.spec\.mjs/,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 832 },
        deviceScaleFactor: 1,
        colorScheme: 'light',
        reducedMotion: 'reduce',
        locale: 'en-CA'
      }
    },
    {
      name: 'figma-mobile',
      testMatch: /visual-fidelity\.spec\.mjs/,
      use: {
        browserName: 'chromium',
        viewport: { width: 402, height: 874 },
        deviceScaleFactor: 1,
        isMobile: true,
        hasTouch: true,
        colorScheme: 'light',
        reducedMotion: 'reduce',
        locale: 'en-CA'
      }
    }
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
