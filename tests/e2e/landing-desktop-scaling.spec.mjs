import { test, expect } from '@playwright/test'
import { assertNoHorizontalOverflow } from './support.mjs'
import { trackFrontendHealth } from './frontend-health.mjs'

const desktopViewports = [
  { width: 1024, height: 768 },
  { width: 1280, height: 720 },
  { width: 1366, height: 768 },
  { width: 1440, height: 900 },
  { width: 1536, height: 864 },
  { width: 1600, height: 900 },
  { width: 1648, height: 928 },
  { width: 1920, height: 1080 },
  { width: 2560, height: 1440 }
]

async function waitForDesktopLanding(page) {
  await page.waitForFunction(() => document.querySelector('.landing-stage--desktop')?.dataset.ready === 'true')
  await expect(page.locator('.landing-stage--desktop')).toBeVisible()
  await expect(page.locator('.landing-stage--mobile')).not.toBeVisible()
}

async function landingMetrics(page) {
  return page.evaluate(() => {
    const rect = (selector) => {
      const node = document.querySelector(selector)
      if (!node) return null
      const box = node.getBoundingClientRect()
      return { left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: box.width, height: box.height }
    }

    const stage = rect('.landing-stage--desktop')
    const sticky = rect('.landing-sticky-left')
    const canvas = rect('.landing-canvas--desktop')
    const hero = rect('.hero--desktop')
    const phone = rect('.hero-phone-composite--desktop')
    const cta = rect('.final-cta--desktop')
    const footer = rect('#footer-d')
    const footerNav = rect('#footer-d .footer-columns')

    return {
      viewportWidth: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      stage,
      sticky,
      canvas,
      hero,
      phone,
      cta,
      footer,
      footerNav
    }
  })
}

for (const viewport of desktopViewports) {
  test(`landing remains proportional at ${viewport.width}x${viewport.height}`, async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chromium', 'Desktop viewport matrix only')

    await page.setViewportSize(viewport)
    const health = trackFrontendHealth(page, { baseURL: testInfo.project.use.baseURL, strictConsole: false })
    await page.goto('/')
    await waitForDesktopLanding(page)
    await assertNoHorizontalOverflow(page)

    const metrics = await landingMetrics(page)
    expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.viewportWidth + 1)

    // The desktop composition fills normal desktop widths and stops growing at
    // the canonical 1440px canvas on larger monitors.
    const expectedStageWidth = Math.min(viewport.width, 1440)
    expect(Math.abs(metrics.stage.width - expectedStageWidth)).toBeLessThanOrEqual(2)
    expect(Math.abs(metrics.stage.left - (viewport.width - metrics.stage.width) / 2)).toBeLessThanOrEqual(2)

    // Both columns must stay inside the canonical stage and remain usable.
    expect(metrics.sticky.left).toBeGreaterThanOrEqual(metrics.stage.left - 1)
    expect(metrics.canvas.right).toBeLessThanOrEqual(metrics.stage.right + 1)
    expect(metrics.sticky.width).toBeGreaterThan(330)
    expect(metrics.canvas.width).toBeGreaterThan(400)

    // The hero phone must remain contained by the visual half of the hero.
    expect(metrics.phone.left).toBeGreaterThanOrEqual(metrics.hero.left - 1)
    expect(metrics.phone.right).toBeLessThanOrEqual(metrics.hero.right + 1)
    expect(metrics.phone.top).toBeGreaterThanOrEqual(metrics.hero.top)
    expect(metrics.phone.bottom).toBeLessThanOrEqual(metrics.hero.bottom + 1)

    // The CTA and footer stay in normal document flow: no translated canvas or
    // multi-hundred-pixel phantom spacer between them.
    const ctaToFooterGap = metrics.footer.top - metrics.cta.bottom
    expect(ctaToFooterGap).toBeGreaterThanOrEqual(40)
    expect(ctaToFooterGap).toBeLessThanOrEqual(100)

    // Footer artwork is full bleed, while its navigation remains bounded to the
    // same canonical desktop width.
    expect(metrics.footer.left).toBeLessThanOrEqual(1)
    expect(metrics.footer.right).toBeGreaterThanOrEqual(viewport.width - 1)
    expect(metrics.footerNav.width).toBeLessThanOrEqual(1440.5)
    expect(metrics.footerNav.left).toBeGreaterThanOrEqual(-1)
    expect(metrics.footerNav.right).toBeLessThanOrEqual(viewport.width + 1)
    expect(metrics.footerNav.top - metrics.footer.top).toBeLessThanOrEqual(122)

    // Attach a full-page render for CI/debug review at every representative
    // desktop size without making the test depend on machine-specific pixels.
    await testInfo.attach(`landing-${viewport.width}x${viewport.height}`, {
      body: await page.screenshot({ fullPage: true, animations: 'disabled' }),
      contentType: 'image/png'
    })

    health.assertHealthy()
  })
}
