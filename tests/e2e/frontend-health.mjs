import { expect } from '@playwright/test'

const frontendResourceTypes = new Set(['document', 'stylesheet', 'script', 'image', 'font'])

function normalizedOrigin(value) {
  try {
    return new URL(value).origin
  } catch {
    return null
  }
}

export function trackFrontendHealth(page, { baseURL, additionalOrigins = [], strictConsole = true } = {}) {
  const monitoredOrigins = new Set([baseURL, ...additionalOrigins].map(normalizedOrigin).filter(Boolean))
  const failures = []

  function isMonitored(url) {
    const origin = normalizedOrigin(url)
    return Boolean(origin && monitoredOrigins.has(origin))
  }

  page.on('response', (response) => {
    const request = response.request()
    if (!frontendResourceTypes.has(request.resourceType())) return
    if (!isMonitored(response.url())) return
    if (response.status() < 400) return
    failures.push(`${request.resourceType()} ${response.status()} ${response.url()}`)
  })

  page.on('requestfailed', (request) => {
    if (!frontendResourceTypes.has(request.resourceType())) return
    if (!isMonitored(request.url())) return
    const reason = request.failure()?.errorText || 'request failed'
    if (/ERR_ABORTED/i.test(reason)) return
    failures.push(`${request.resourceType()} ${reason} ${request.url()}`)
  })

  page.on('pageerror', (error) => {
    failures.push(`pageerror ${error.message}`)
  })

  if (strictConsole) {
    page.on('console', (message) => {
      if (message.type() !== 'error') return
      failures.push(`console ${message.text()}`)
    })
  }

  return {
    failures,
    assertHealthy() {
      expect(failures, `Frontend failures:\n${failures.join('\n')}`).toEqual([])
    }
  }
}

export async function assertImagesLoaded(page, selector = 'img') {
  await page.waitForFunction((imageSelector) => {
    return [...document.querySelectorAll(imageSelector)].every((image) => image.complete)
  }, selector)

  const brokenImages = await page.locator(selector).evaluateAll((images) => images
    .filter((image) => image.currentSrc && image.naturalWidth === 0)
    .map((image) => ({
      alt: image.getAttribute('alt') || '',
      src: image.currentSrc || image.getAttribute('src') || ''
    })))

  expect(brokenImages, `Broken images:\n${JSON.stringify(brokenImages, null, 2)}`).toEqual([])
}

export async function assertLandingVisualContract(page) {
  const selectors = [
    '.site-header',
    '.hero-copy h1',
    '.hero-playground',
    '.phone-shell',
    '#hero-deck',
    '#how',
    '#safety',
    '.final-cta',
    '.site-footer'
  ]
  for (const selector of selectors) await expect(page.locator(selector)).toBeVisible()
  await expect(page.locator('#hero-deck .event-card')).toHaveCount(3)
  await expect(page.getByRole('link', { name: /Get Started/i })).toBeVisible()

  const desktop = await page.evaluate(() => window.innerWidth >= 768)
  if (desktop) {
    await expect(page.locator('.desktop-nav')).toBeVisible()
    await expect(page.locator('.menu-button')).toBeHidden()
  } else {
    await expect(page.locator('.desktop-nav')).toBeHidden()
    await expect(page.locator('.menu-button')).toBeVisible()
  }
}

export async function assertProductVisualContract(page) {
  const shell = page.locator('.minimal-product-shell')
  const main = page.locator('.minimal-product-main')
  const sidebar = page.locator('.minimal-product-sidebar')
  const desktopNav = page.locator('.minimal-product-nav')
  const mobileNav = page.locator('.minimal-mobile-nav')
  const header = page.locator('.minimal-product-header')

  await expect(shell).toBeVisible()
  await expect(main).toBeVisible()

  const desktop = await page.evaluate(() => window.innerWidth >= 768)
  if (desktop) {
    await expect(sidebar).toBeVisible()
    await expect(desktopNav).toBeVisible()
    await expect(mobileNav).toBeHidden()

    if (await header.isVisible()) {
      await expect(page.getByLabel('Open profile menu')).toBeVisible()
    } else {
      await expect(header).toBeHidden()
    }
  } else {
    await expect(header).toBeVisible()
    await expect(page.locator('.minimal-header-logo')).toBeVisible()
    await expect(page.locator('.profile-menu')).toBeHidden()
    await expect(sidebar).toBeHidden()
    await expect(mobileNav).toBeVisible()
  }
}
