import { test, expect } from '@playwright/test'

const thread = '00000000-0000-4000-8000-000000000003'
const screens = [
  ['/discover', '.figma-swipe-screen'], ['/map', '[data-testid="feed-stream"]'],
  ['/map?view=map', '.location-map-canvas'], ['/plans', '[data-testid="saved-grid"]'],
  ['/profile', '.figma-profile-cards'], ['/membership', '.figma-pass-screen'],
  ['/membership?view=manage', '.figma-pass-screen'], ['/matches', '.figma-friends-conversations'],
  ['/matches?tab=add', '.figma-friends-add-view'], ['/matches?tab=shared', '.figma-friends-shared-view'],
  ['/account', '.figma-settings-window'], ['/create/post', '.figma-create-post-card'],
  ['/signup', '.auth-panel'], ['/forgot-password', '.auth-panel'], ['/onboarding', '.pdl-onb-page'],
  ['/public/place', '.public-page'], ['/public/city', '.place-hub'],
  ['/editor', '.content-editor'], ['/recommendations', '.recommendation-settings-grid'],
  ['/legal', '.legal-page'], ['/loading', '.puddle-main-spinner']
]

test.beforeEach(async ({ context }) => {
  // No external API, font, tile, image or paid-service calls in this suite.
  await context.route('**/*', route => {
    const url = new URL(route.request().url())
    return ['127.0.0.1', 'localhost'].includes(url.hostname) ? route.continue() : route.abort()
  })
})

async function appearance(page, testInfo) {
  if (testInfo.project.name.endsWith('-dark')) {
    const shell = page.locator('.figma-dashboard-shell').first()
    if (await shell.count()) await expect(shell).toHaveAttribute('data-resolved-appearance', /light|dark/)
    await page.locator('.figma-dashboard-shell').evaluateAll(nodes => nodes.forEach(node => {
      node.dataset.appearance = 'dark'
      node.dataset.resolvedAppearance = 'dark'
    }))
    if (await shell.count()) expect(await shell.evaluate(node => getComputedStyle(node).getPropertyValue('--shell-surface').trim())).toBe('#111315')
    if (await page.getByTestId('saved-card').count()) {
      expect(await page.getByTestId('saved-card').first().evaluate(node => getComputedStyle(node).backgroundColor)).toBe('rgb(17, 19, 21)')
    }
  }
}

async function capture(page, testInfo, name) {
  await page.evaluate(() => document.fonts.ready)
  const path = testInfo.outputPath(name + '.png')
  await page.screenshot({ path, animations: 'disabled' })
  await testInfo.attach(name, { path, contentType: 'image/png' })
}

async function noHorizontalOverflow(page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1)
}

async function inside(child, parent) {
  const a = await child.boundingBox(), b = await parent.boundingBox()
  expect(a).not.toBeNull()
  expect(b).not.toBeNull()
  expect(a.x).toBeGreaterThanOrEqual(b.x - 1)
  expect(a.y).toBeGreaterThanOrEqual(b.y - 1)
  expect(a.x + a.width).toBeLessThanOrEqual(b.x + b.width + 1)
  expect(a.y + a.height).toBeLessThanOrEqual(b.y + b.height + 1)
}

async function sameCenter(a, b) {
  await expect.poll(async () => {
    const first = await a.boundingBox(), second = await b.boundingBox()
    if (!first || !second) return Infinity
    return Math.abs(first.x + first.width / 2 - second.x - second.width / 2)
  }).toBeLessThanOrEqual(1)
}

test('all presentation families render without horizontal overflow or client exceptions', async ({ page }, testInfo) => {
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  for (const [route, selector] of screens) {
    await page.goto(route)
    await expect(page.locator(selector).first(), route).toBeVisible()
    await appearance(page, testInfo)
    const shell = page.locator('.figma-dashboard-shell').first()
    if (await shell.count()) expect(await shell.evaluate(node => getComputedStyle(node).getPropertyValue('--font-sans').trim())).not.toBe('')
    if (route === '/profile') {
      const hierarchy = await page.locator('.figma-profile-identity').evaluate(node => {
        const heading = getComputedStyle(node.querySelector('h1'))
        return { scale: parseFloat(heading.fontSize) / parseFloat(getComputedStyle(node).fontSize), weight: Number(heading.fontWeight) }
      })
      expect(hierarchy.scale).toBeGreaterThan(1.5)
      expect(hierarchy.weight).toBeGreaterThanOrEqual(700)
      for (const card of await page.locator('.figma-profile-card').all()) {
        for (const content of await card.locator(':scope > *').all()) await inside(content, card)
      }
      const signOut = page.locator('.figma-profile-signout').getByRole('button', { name: 'Sign out' })
      if (page.viewportSize().width <= 760) await expect(signOut).toBeVisible()
      else await expect(signOut).toBeHidden()
    }
    await noHorizontalOverflow(page)
    await capture(page, testInfo, route.replaceAll(/[^a-z0-9]/gi, '-'))
  }
  expect(errors).toEqual([])
})

test('Swipe keeps its dock and details inside the viewport while permitting viewport-wide drag', async ({ page }, testInfo) => {
  await page.goto('/discover')
  const card = page.locator('.figma-swipe-card.is-active'), stage = page.locator('.figma-swipe-card-stage')
  await expect(card).toBeVisible()
  await appearance(page, testInfo)
  await inside(page.locator('.figma-swipe-details-button').first(), card)
  const nav = page.locator('.figma-dashboard-mobile-nav')
  const bottom = await nav.isVisible() ? (await nav.boundingBox()).y : page.viewportSize().height
  for (const button of await page.locator('.figma-swipe-actions button').all()) {
    const box = await button.boundingBox()
    expect(box.y + box.height).toBeLessThanOrEqual(bottom)
  }
  const box = await card.boundingBox(), originalStage = await stage.boundingBox()
  const x = box.x + box.width / 2, y = box.y + box.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(page.viewportSize().width - 2, y, { steps: 8 })
  expect((await card.boundingBox()).x).toBeGreaterThan(originalStage.x)
  await page.mouse.move(x, y, { steps: 8 })
  await page.mouse.up()
  await page.locator('.figma-swipe-details-button').first().click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.getByRole('button', { name: 'Close details' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)

  for (const direction of [-1, 1]) {
    const previousId = await card.getAttribute('data-location-id')
    const previewId = await page.locator('.figma-swipe-card.is-preview').getAttribute('data-location-id')
    const bounds = await card.boundingBox()
    expect(await card.locator('img').first().evaluate(image => image.draggable)).toBe(false)
    await card.evaluate(node => {
      window.swipeExitSamples = []
      const sample = () => {
        if (!node.isConnected) return
        if (node.classList.contains('is-leaving')) {
          const rect = node.getBoundingClientRect()
          window.swipeExitSamples.push({ left: rect.left, right: rect.right, opacity: getComputedStyle(node).opacity })
        }
        requestAnimationFrame(sample)
      }
      requestAnimationFrame(sample)
    })
    const startX = bounds.x + bounds.width / 2, startY = bounds.y + bounds.height / 2
    await page.mouse.move(startX, startY)
    await page.mouse.down()
    await page.mouse.move(direction < 0 ? 1 : page.viewportSize().width - 1, startY, { steps: 8 })
    await page.mouse.up()
    await expect(card).not.toHaveAttribute('data-location-id', previousId)
    await expect(card).toHaveAttribute('data-location-id', previewId)
    const samples = await page.evaluate(() => window.swipeExitSamples)
    expect(samples.length).toBeGreaterThan(0)
    expect(samples.every(sample => Number(sample.opacity) === 1)).toBe(true)
    const exit = samples.at(-1)
    if (direction < 0) expect(exit.right).toBeLessThanOrEqual(0)
    else expect(exit.left).toBeGreaterThanOrEqual(page.viewportSize().width)
  }
  await capture(page, testInfo, 'swipe')
})

test('Saved search stays viewport anchored and the dialog close remains reachable after scrolling', async ({ page }, testInfo) => {
  await page.goto('/plans')
  await expect(page.locator('[data-saved-morph-card] h2 a').first()).toBeVisible()
  await appearance(page, testInfo)
  const grid = page.getByTestId('saved-grid')
  const cards = page.getByTestId('saved-card')
  expect(await cards.count()).toBeGreaterThan(1)
  for (const card of await cards.all()) {
    await inside(card, grid)
    await inside(card.locator('h2'), card)
  }
  await noHorizontalOverflow(page)
  const search = page.getByTestId('saved-search'), initial = await search.boundingBox()
  await sameCenter(search, page.getByTestId('saved-tabs'))
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
  expect((await search.boundingBox()).y).toBeCloseTo(initial.y, 1)
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.locator('[data-saved-morph-card] h2 a').first().click()
  const close = page.locator('.saved-inline-detail-close'), frame = page.locator('.saved-inline-detail-frame')
  await expect(close).toBeVisible()
  await inside(close, frame)
  const start = await close.boundingBox()
  await page.locator('.saved-inline-detail-card').evaluate(node => { node.scrollTop = node.scrollHeight })
  expect((await close.boundingBox()).y).toBeCloseTo(start.y, 1)
  await inside(close, frame)
  await capture(page, testInfo, 'saved-dialog')
  await close.click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

test('Feed cards, pill and composer share a centerline; search does not blur the Feed', async ({ page }, testInfo) => {
  await page.goto('/map')
  const post = page.getByTestId('feed-post').first()
  await expect(post).toBeVisible()
  await appearance(page, testInfo)
  await sameCenter(post, page.getByTestId('feed-tabs'))
  await sameCenter(page.getByTestId('feed-composer'), page.getByTestId('feed-tabs'))
  const initial = await page.getByTestId('feed-composer').boundingBox()
  await page.evaluate(() => window.scrollTo(0, 400))
  expect((await page.getByTestId('feed-composer').boundingBox()).y).toBeCloseTo(initial.y, 1)
  await page.getByTestId('feed-search').click()
  await expect(page.locator('.puddle-search-overlay.is-open')).toBeVisible()
  expect(await page.locator('.puddle-discover-search-backdrop').evaluate(node => getComputedStyle(node).backdropFilter)).toBe('none')
  await page.keyboard.press('Escape')
  await capture(page, testInfo, 'feed')
})

test('map and Messages use only the space above mobile navigation', async ({ page }, testInfo) => {
  for (const route of ['/map?view=map', '/matches?conversation=' + thread]) {
    await page.goto(route)
    const area = route.startsWith('/map') ? page.locator('.location-map-canvas') : page.locator('.figma-friends-chat')
    await expect(area).toBeVisible()
    await appearance(page, testInfo)
    const mobile = page.viewportSize().width <= 760
    if (mobile) {
      const nav = page.locator('.figma-dashboard-mobile-nav')
      await expect(nav).toBeVisible()
      const box = await area.boundingBox(), navBox = await nav.boundingBox()
      expect(box.y + box.height).toBeLessThanOrEqual(navBox.y + 1)
      expect(await page.evaluate(() => document.documentElement.scrollHeight - innerHeight)).toBeLessThanOrEqual(1)
      if (route.startsWith('/matches')) {
        await expect(page.locator('.figma-friends-tabs')).toBeHidden()
        await expect(page.getByRole('link', { name: 'Back to conversations' })).toBeVisible()
      }
    }
    await capture(page, testInfo, route.startsWith('/map') ? 'map-mode' : 'conversation')
  }
  if (page.viewportSize().width <= 760) {
    await page.getByRole('link', { name: 'Back to conversations' }).click()
    await expect(page.locator('.figma-friends-conversations')).toBeVisible()
    await expect(page.locator('.figma-friends-tabs')).toBeVisible()
    await expect(page.locator('.figma-friends-chat')).toBeHidden()
  }
})

test('Settings uses shared section navigation and the loading indicator is centered', async ({ page }, testInfo) => {
  const mobile = page.viewportSize().width <= 760
  await page.goto(mobile ? '/account?mobile=1' : '/account')
  await appearance(page, testInfo)
  if (mobile) {
    await page.getByRole('link', { name: /^Appearance/ }).click()
    await expect(page.locator('#appearance')).toBeVisible()
    await expect(page.locator('#profile')).toHaveCount(0)
    await page.getByRole('link', { name: 'Back to Settings' }).click()
    await expect(page.locator('.figma-settings-local-nav')).toBeVisible()
  } else {
    const window = page.locator('.figma-settings-window'), main = page.locator('.figma-dashboard-main')
    await sameCenter(window, main)
    await expect.poll(() => page.evaluate(() => {
      const window = document.querySelector('.figma-settings-window').getBoundingClientRect()
      const main = document.querySelector('.figma-dashboard-main').getBoundingClientRect()
      return Math.abs(window.y + window.height / 2 - main.y - main.height / 2)
    })).toBeLessThanOrEqual(1)
  }
  await page.goto('/loading')
  const spinner = page.locator('.puddle-main-spinner')
  await expect(spinner).toBeVisible()
  await sameCenter(spinner, page.locator('.figma-dashboard-main'))
  const box = await spinner.boundingBox(), availableHeight = mobile ? (await page.locator('.figma-dashboard-mobile-nav').boundingBox()).y : page.viewportSize().height
  expect(Math.abs(box.y + box.height / 2 - availableHeight / 2)).toBeLessThanOrEqual(1)
})

test('reduced motion does not change Saved dialog geometry', async ({ page }, testInfo) => {
  await page.goto('/plans')
  await page.locator('[data-saved-morph-card] h2 a').first().click()
  const frame = page.locator('.saved-inline-detail-frame')
  await expect(frame).toBeVisible()
  const before = await frame.boundingBox()
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const after = await frame.boundingBox()
  for (const property of ['x', 'y', 'width', 'height']) expect(after[property]).toBeCloseTo(before[property], 1)
  await inside(page.locator('.saved-inline-detail-close'), frame)
})

test('landing legal links open readable policy pages and return home', async ({ page }) => {
  await page.goto('/landing.html')
  const mobile = page.viewportSize().width <= 760
  const canvas = page.locator('.landing-canvas--' + (mobile ? 'mobile' : 'desktop'))
  await page.locator('.site-footer--' + (mobile ? 'mobile' : 'desktop')).getByRole('link', { name: 'Privacy', exact: true }).click()
  await expect(page).toHaveURL(/\/privacy$/)
  await expect(page.getByRole('heading', { name: 'Privacy Policy', exact: true })).toBeVisible()
  expect(await page.locator('.legal-section').count()).toBeGreaterThan(0)
  await noHorizontalOverflow(page)
  await page.getByRole('navigation', { name: 'Legal document navigation' }).getByRole('link', { name: 'Read the Terms of Service' }).click()
  await expect(page).toHaveURL(/\/terms$/)
  await expect(page.getByRole('heading', { name: 'Terms of Service', exact: true })).toBeVisible()
  expect(await page.locator('.legal-section').count()).toBeGreaterThan(0)
  await noHorizontalOverflow(page)
  await page.locator('.legal-header').getByRole('link', { name: /Back to home/ }).click()
  await expect(page).toHaveURL(/\/$/)
  await expect(canvas).toBeVisible()
})

test('landing phones keep independent styles and all actions inside each screen', async ({ page }, testInfo) => {
  await page.goto('/landing.html')
  const mobile = page.viewportSize().width <= 760
  const canvas = page.locator('.landing-canvas--' + (mobile ? 'mobile' : 'desktop'))
  await expect(canvas).toBeVisible()
  await noHorizontalOverflow(page)
  const sections = await canvas.locator(':scope > section, :scope > footer').evaluateAll(nodes => nodes.map(node => {
    const rect = node.getBoundingClientRect()
    return { top: rect.top, bottom: rect.bottom }
  }))
  for (let index = 1; index < sections.length; index++) expect(sections[index].top).toBeGreaterThanOrEqual(sections[index - 1].bottom - 1)
  if (mobile) {
    await sameCenter(canvas.locator('.hero-phone-composite'), canvas.locator('.hero'))
    await sameCenter(canvas.locator('.discovery h2'), canvas.locator('.discovery'))
    await page.locator('.mobile-login-button').click()
    await expect(page.locator('.mobile-login-dialog')).toBeVisible()
  }
  const panel = page.locator('.login-panel')
  await panel.getByRole('tab', { name: 'Sign up', exact: true }).click()
  await expect(panel.getByLabel('Display name')).toBeVisible()
  await expect(panel.locator('.landing-login-form')).toBeHidden()
  const authContainer = page.locator(mobile ? '.mobile-login-dialog' : '.landing-sticky-left__canvas')
  for (const action of await panel.locator('.landing-signup-form .auth-choice').all()) {
    await action.scrollIntoViewIfNeeded()
    await inside(action, authContainer)
  }
  await panel.getByRole('tab', { name: 'Log in', exact: true }).click()
  await expect(panel.locator('.landing-login-form')).toBeVisible()
  await expect(panel.locator('.landing-signup-form')).toBeHidden()
  if (mobile) {
    await page.getByRole('button', { name: 'Close log in' }).click()
    await expect(page.locator('.mobile-login-dialog')).toBeHidden()
  }
  for (const view of ['swipe', 'save', 'feed']) {
    const section = page.locator('.feature-card--' + (mobile ? 'm-' : 'd-') + view)
    await section.scrollIntoViewIfNeeded()
    const frame = section.locator('iframe').contentFrame()
    await expect(frame.locator('.landing-phone-demo__screen')).toBeVisible()
    const phone = await section.locator('.feature-phone').boundingBox()
    const badge = await section.locator('.interactive-pill').boundingBox()
    expect(badge.y).toBeGreaterThanOrEqual(phone.y + phone.height)
    expect(await frame.locator('.landing-phone-demo__screen').evaluate(node => node.scrollHeight - node.clientHeight)).toBeLessThanOrEqual(1)
    if (view === 'swipe') {
      for (const action of await frame.locator('.landing-demo-swipe-actions button').all()) await inside(action, frame.locator('.landing-phone-demo__screen'))
      await frame.getByRole('button', { name: 'Open Maple Grove Park', exact: true }).click()
      await expect(frame.getByRole('dialog')).toBeVisible()
      await frame.getByRole('button', { name: 'Close details' }).click()
    }
    await capture(page, testInfo, 'landing-' + view)
  }
})

