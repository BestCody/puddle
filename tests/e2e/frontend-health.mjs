import { expect } from '@playwright/test'

const frontendResourceTypes = new Set(['document', 'stylesheet', 'script', 'image', 'font'])

function normalizedOrigin(value) {
  try {
    return new URL(value).origin
  } catch {
    return null
  }
}

export function trackFrontendHealth(page, { baseURL, strictConsole = true } = {}) {
  const firstPartyOrigin = normalizedOrigin(baseURL)
  const failures = []

  function isFirstParty(url) {
    const origin = normalizedOrigin(url)
    return Boolean(origin && firstPartyOrigin && origin === firstPartyOrigin)
  }

  page.on('response', (response) => {
    const request = response.request()
    if (!frontendResourceTypes.has(request.resourceType())) return
    if (!isFirstParty(response.url())) return
    if (response.status() < 400) return
    failures.push(`${request.resourceType()} ${response.status()} ${response.url()}`)
  })

  page.on('requestfailed', (request) => {
    if (!frontendResourceTypes.has(request.resourceType())) return
    if (!isFirstParty(request.url())) return
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
    const bodyTextLength = document.body.innerText.trim().length
    return {
      viewportWidth: window.innerWidth,
      bodyTextLength,
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
