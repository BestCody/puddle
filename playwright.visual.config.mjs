import { defineConfig } from '@playwright/test'

const production = process.env.CSS_VISUAL_PRODUCTION === '1'
const port = production ? 3118 : 3117
const origin = `http://127.0.0.1:${port}`

export default defineConfig({
  testDir: './tests/visual',
  testMatch: '**/*.spec.mjs',
  workers: 1,
  retries: 0,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { outputFolder: '.e2e-local/css-report', open: 'never' }]],
  outputDir: '.e2e-local/css-regression',
  use: {
    baseURL: origin,
    browserName: 'chromium',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure'
  },
  projects: [
    { name: 'small-phone', use: { viewport: { width: 320, height: 568 } } },
    { name: 'phone', use: { viewport: { width: 393, height: 844 } } },
    { name: 'tablet', use: { viewport: { width: 820, height: 1180 } } },
    { name: 'desktop', use: { viewport: { width: 1440, height: 900 } } },
    { name: 'desktop-short', use: { viewport: { width: 1440, height: 640 } } },
    { name: 'phone-landscape', use: { viewport: { width: 844, height: 393 } } },
    { name: 'wide-desktop', use: { viewport: { width: 1920, height: 1080 } } },
    { name: 'phone-dark', use: { viewport: { width: 393, height: 844 }, colorScheme: 'dark' } },
    { name: 'desktop-dark', use: { viewport: { width: 1440, height: 900 }, colorScheme: 'dark' } }
  ],
  webServer: {
    command: production
      ? `node node_modules/next/dist/bin/next build tests/visual/fixture && node node_modules/next/dist/bin/next start tests/visual/fixture --hostname 127.0.0.1 --port ${port}`
      : `node node_modules/next/dist/bin/next dev tests/visual/fixture --hostname 127.0.0.1 --port ${port}`,
    url: `${origin}/discover`,
    reuseExistingServer: !production && !process.env.CI,
    timeout: 180_000,
    env: { NEXT_TELEMETRY_DISABLED: '1' }
  }
})

