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
    '.phone-shell',
    '#how',
    '#social',
    '#organizers',
    '#safety',
    '.final-cta'
  ]
  for (const selector of selectors) await expect(page.locator(selector)).toBeVisible()

  const layout = await page.evaluate(() => {
    const readBox = (selector) => {
      const element = document.querySelector(selector)
      if (!element) return null
      const box = element.getBoundingClientRect()
      return { x: box.x, y: box.y, width: box.width, height: box.height, right: box.right, bottom: box.bottom }
    }
    const display = (selector) => {
      const element = document.querySelector(selector)
      return element ? getComputedStyle(element).display : null
    }
    const heading = document.querySelector('.hero-copy h1')
    return {
      viewportWidth: window.innerWidth,
      bodyTextLength: document.body.innerText.trim().length,
      headingFontSize: heading ? Number.parseFloat(getComputedStyle(heading).fontSize) : 0,
      header: readBox('.site-header'),
      heroCopy: readBox('.hero-copy'),
      phone: readBox('.phone-shell'),
      desktopNavDisplay: display('.desktop-nav'),
      menuDisplay: display('.menu-button')
    }
  })

  expect(layout.bodyTextLength).toBeGreaterThan(500)
  expect(layout.headingFontSize).toBeGreaterThanOrEqual(36)
  expect(layout.header?.width || 0).toBeGreaterThan(250)
  expect(layout.header?.width || Infinity).toBeLessThanOrEqual(layout.viewportWidth + 1)
  expect(layout.phone?.width || 0).toBeGreaterThan(270)
  expect(layout.phone?.height || 0).toBeGreaterThan(480)

  if (layout.viewportWidth >= 768) {
    expect(layout.desktopNavDisplay).not.toBe('none')
    expect(layout.menuDisplay).toBe('none')
    expect(layout.heroCopy?.x || 0).toBeLessThan(layout.phone?.x || Infinity)
  } else {
    expect(layout.desktopNavDisplay).toBe('none')
    expect(layout.menuDisplay).not.toBe('none')
    expect(layout.heroCopy?.y || 0).toBeLessThan(layout.phone?.y || Infinity)
  }
}

export async function assertProductVisualContract(page) {
  const shell = page.locator('.minimal-product-shell')
  const header = page.locator('.minimal-product-header')
  const main = page.locator('.minimal-product-main')
  await expect(shell).toBeVisible()
  await expect(header).toBeVisible()
  await expect(main).toBeVisible()
  await expect(page.getByLabel('Open profile menu')).toBeVisible()

  const layout = await page.evaluate(() => {
    const read = (selector) => {
      const element = document.querySelector(selector)
      if (!element) return null
      const style = getComputedStyle(element)
      const box = element.getBoundingClientRect()
      return {
        display: style.display,
        position: style.position,
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height,
        right: box.right,
        bottom: box.bottom
      }
    }
    return {
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      shell: read('.minimal-product-shell'),
      sidebar: read('.minimal-product-sidebar'),
      desktopNav: read('.minimal-product-nav'),
      mobileNav: read('.minimal-mobile-nav'),
      stage: read('.minimal-product-stage'),
      header: read('.minimal-product-header'),
      main: read('.minimal-product-main')
    }
  })

  expect(layout.shell?.width || 0).toBeGreaterThan(300)
  expect(layout.main?.width || 0).toBeGreaterThan(280)
  expect(layout.header?.height || 0).toBeGreaterThanOrEqual(50)

  if (layout.viewportWidth >= 768) {
    expect(layout.sidebar?.display).not.toBe('none')
    expect(layout.desktopNav?.display).not.toBe('none')
    expect(layout.mobileNav?.display).toBe('none')
    expect(layout.sidebar?.width || 0).toBeGreaterThanOrEqual(60)
    expect(layout.stage?.x || 0).toBeGreaterThanOrEqual((layout.sidebar?.right || 0) - 1)
  } else {
    expect(layout.sidebar?.display).toBe('none')
    expect(layout.mobileNav?.display).not.toBe('none')
    expect(layout.mobileNav?.position).toBe('fixed')
    expect(layout.mobileNav?.bottom || Infinity).toBeLessThanOrEqual(layout.viewportHeight + 1)
    expect(layout.main?.width || Infinity).toBeLessThanOrEqual(layout.viewportWidth + 1)
  }
}
