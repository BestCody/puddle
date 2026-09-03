import { test, expect } from '@playwright/test'
import { assertNoHorizontalOverflow } from './support.mjs'
import { assertImagesLoaded, trackFrontendHealth } from './frontend-health.mjs'

const publicPages = [
  ['/', null],
  ['/signup', 'Make plans that leave the chat.'],
  ['/privacy', 'Privacy Policy'],
  ['/terms', 'Terms of Service']
]

function expectedLandingMode(width) { return width <= 760 ? 'mobile' : 'desktop' }
function landingAuthRoot(mode) { return mode === 'desktop' ? '.landing-sticky-left' : '.landing-canvas--mobile' }

async function visibleLandingCanvas(page) {
  const width = await page.evaluate(() => window.innerWidth)
  const mode = expectedLandingMode(width)
  const stage = `.landing-stage--${mode}`
  const selector = `.landing-canvas--${mode}`
  await page.waitForFunction((stageSelector) => document.querySelector(stageSelector)?.dataset.ready === 'true', stage)
  await expect(page.locator(stage)).toBeVisible()
  await expect(page.locator(mode === 'desktop' ? '.landing-stage--mobile' : '.landing-stage--desktop')).not.toBeVisible()
  await expect(page.locator(selector)).toBeVisible()
  if (mode === 'desktop') await expect(page.locator('.landing-sticky-left__canvas')).toBeVisible()
  return { mode, stage, selector, authRoot: landingAuthRoot(mode) }
}

for (const [path, heading] of publicPages) {
  test(`${path} renders without frontend failures or horizontal overflow`, async ({ page }, testInfo) => {
    const health = trackFrontendHealth(page, { baseURL: testInfo.project.use.baseURL, strictConsole: path !== '/' })
    await page.goto(path)
    if (path === '/') await visibleLandingCanvas(page)
    else await expect(page.getByRole('heading', { name: heading, level: 1 })).toBeVisible()
    await assertImagesLoaded(page)
    await assertNoHorizontalOverflow(page)
    health.assertHealthy()
  })
}

test('landing page uses the Figma responsive composition and real DOM content', async ({ page }, testInfo) => {
  const health = trackFrontendHealth(page, { baseURL: testInfo.project.use.baseURL, strictConsole: false })
  await page.goto('/')
  const { mode, stage, selector, authRoot } = await visibleLandingCanvas(page)

  if (mode === 'desktop') {
    await expect(page.locator('[data-figma-node="352:484"]')).toBeVisible()
    await expect(page.locator('.landing-sticky-left form.landing-login-form input:not([type="hidden"])')).toHaveCount(2)
    await expect(page.locator('.feature-card--d-swipe')).toBeVisible()
    await expect(page.locator('.feature-card--d-profile')).toHaveCount(0)
  } else {
    await expect(page.locator('[data-figma-node="351:156"]')).toBeVisible()
    await expect(page.locator('.feature-card--m-swipe')).toBeVisible()
    await expect(page.locator('.feature-card--m-profile')).toHaveCount(0)
    await expect(page.locator('.mobile-login-button')).toBeVisible()
    await expect(page.locator('.landing-sticky-left')).not.toBeVisible()
  }

  await expect(page.locator('img[src="/figma/landing-desktop.png"]')).toHaveCount(0)
  await expect(page.locator('img[src="/figma/landing-mobile.png"]')).toHaveCount(0)
  await expect(page.locator(`${selector} .interactive-pill`).first()).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Discover places. See who’s there.', level: 1 })).toBeVisible()

  if (mode === 'desktop') {
    expect(await page.locator(`${authRoot} a[href="/signup"]`).count()).toBeGreaterThan(0)
    expect(await page.locator(`${authRoot} a[href="/api/auth/google?next=%2Fdiscover"]`).count()).toBeGreaterThan(0)
  } else {
    await expect(page.locator('.mobile-login-button')).toHaveAttribute('href', '/?mode=login')
    await expect(page.locator('.brand--mobile img')).toHaveAttribute('src', '/figma/assets/mobile-logo-exact.svg')
  }
  for (const path of ['/privacy', '/terms']) expect(await page.locator(`${stage} a[href="${path}"]`).count()).toBeGreaterThan(0)
  await assertImagesLoaded(page)
  await assertNoHorizontalOverflow(page)
  health.assertHealthy()
})

test('landing phone routes render the correct Figma screen identities and hydrate interactions', async ({ page }) => {
  await page.goto('/landing-demo/swipe')
  const swipe = page.locator('[data-demo-screen="swipe"]')
  await expect(swipe).toBeVisible()
  await expect(swipe).toHaveAttribute('data-figma-screen', '40:641')
  await expect(swipe.getByRole('img', { name: 'Puddle' })).toBeVisible()
  await expect(swipe.getByText('Maple Grove Park', { exact: true })).toBeVisible()
  await expect(swipe.getByText('2243 Devon Road, Oakville', { exact: true })).toBeVisible()
  await expect(swipe.getByRole('button', { name: 'Swipe' })).toHaveAttribute('aria-current', 'page')
  await swipe.getByRole('button', { name: 'Save place' }).click()
  await expect(swipe.getByText('Firehall Cool Bar Hot Grill', { exact: true })).toBeVisible()
  await swipe.getByRole('button', { name: 'Back' }).click()
  await expect(swipe.getByText('Maple Grove Park', { exact: true })).toBeVisible()
  await swipe.getByRole('button', { name: 'Saved' }).click()
  await expect(page).toHaveURL(/\/landing-demo\/swipe$/)
  await expect(page.locator('[data-demo-screen="save"]')).toBeVisible()

  await page.goto('/landing-demo/save')
  const saved = page.locator('[data-demo-screen="save"]')
  await expect(saved).toBeVisible()
  await expect(saved).toHaveAttribute('data-figma-screen', '25:180')
  await expect(saved.getByRole('img', { name: 'Puddle' })).toBeVisible()
  await expect(saved.getByText('Firehall Cool Bar Hot Grill', { exact: true })).toBeVisible()
  await expect(saved.locator('.landing-demo-bottom-nav').getByRole('button', { name: 'Saved' })).toHaveAttribute('aria-current', 'page')
  await saved.getByRole('button', { name: 'Plans', exact: true }).click()
  await expect(saved.getByText('Night Gallery', { exact: true })).toBeVisible()
  await saved.locator('.landing-demo-mobile-header .landing-demo-segment').getByRole('button', { name: 'Saved', exact: true }).click()
  await saved.getByRole('button', { name: /Theatres/ }).click()
  await expect(saved.getByText('Film House', { exact: true })).toBeVisible()
  await expect(saved.getByText('Firehall Cool Bar Hot Grill', { exact: true })).toHaveCount(0)
  await saved.getByText('Film House', { exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Film House details' })).toBeVisible()
  await page.getByRole('button', { name: 'Close details' }).click()

  await page.goto('/landing-demo/feed')
  const feed = page.locator('[data-demo-screen="feed"]')
  await expect(feed).toBeVisible()
  await expect(feed).toHaveAttribute('data-figma-screen', '40:519')
  await expect(feed.getByRole('img', { name: 'Puddle' })).toBeVisible()
  await expect(feed.getByText('Richie Zheng', { exact: true })).toBeVisible()
  await expect(feed.getByText(/This place is amazing! The atmosphere is beautiful/)).toBeVisible()
  await expect(feed.locator('.landing-demo-bottom-nav').getByRole('button', { name: 'Feed' })).toHaveAttribute('aria-current', 'page')
  await feed.getByRole('button', { name: 'Map', exact: true }).click()
  await expect(feed.getByLabel('Interactive map preview')).toBeVisible()
  await feed.getByRole('button', { name: 'Open Maple Grove Park' }).click()
  await expect(page.getByRole('dialog', { name: 'Maple Grove Park details' })).toBeVisible()
  await page.getByRole('button', { name: 'Close details' }).click()
  await feed.locator('.landing-demo-feed-toolbar .landing-demo-segment').getByRole('button', { name: 'Feed', exact: true }).click()
  await feed.getByRole('button', { name: 'Search puddle', exact: true }).click()
  await feed.getByPlaceholder('Search puddle').fill('not-a-puddle')
  await expect(feed.getByText('No puddles found.', { exact: true })).toBeVisible()

  await page.goto('/landing-demo/profile')
  const profile = page.locator('[data-demo-screen="profile"]')
  await expect(profile).toBeVisible()
  await expect(profile).toHaveAttribute('data-figma-screen', '40:347')
  await expect(profile.getByRole('heading', { name: 'Richie Zheng', exact: true })).toBeVisible()
  await expect(profile.getByText('@Richiezh77', { exact: true })).toBeVisible()
  await expect(profile.locator('.landing-demo-bottom-nav').getByRole('button', { name: 'Profile', exact: true })).toHaveAttribute('aria-current', 'page')
  await profile.getByRole('button', { name: 'Follow', exact: true }).click()
  await expect(profile.getByRole('button', { name: 'Following', exact: true })).toBeVisible()
  await profile.getByRole('button', { name: 'Edit', exact: true }).click()
  await profile.getByRole('textbox', { name: 'Display name' }).fill('Richie Test')
  await profile.getByRole('button', { name: 'Done', exact: true }).click()
  await expect(profile.getByRole('heading', { name: 'Richie Test', exact: true })).toBeVisible()
  await profile.getByRole('button', { name: /Message/ }).click()
  await expect(page.getByRole('dialog', { name: 'Message Richie Zheng' })).toBeVisible()
  await page.getByRole('button', { name: 'Close message' }).click()
})

test('landing embeds each Figma phone route in the corresponding feature card', async ({ page }) => {
  await page.goto('/')
  const { mode, selector } = await visibleLandingCanvas(page)
  const expected = [
    ['swipe', 'Maple Grove Park'],
    ['save', 'Firehall Cool Bar Hot Grill'],
    ['feed', 'Richie Zheng']
  ]

  for (const [view, identity] of expected) {
    const shell = page.locator(`${selector} [data-phone-demo="${view}"]`)
    await shell.scrollIntoViewIfNeeded()
    await expect(shell).toBeVisible()
    const frame = shell.locator('iframe')
    await expect(frame).toHaveAttribute('src', `/landing-demo/${view}`)
    await expect(frame.contentFrame().getByText(identity, { exact: true }).first()).toBeVisible()
  }
})

test('desktop landing sticky sign-in canvas ends before the full-width footer', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'Desktop sticky-footer behavior only')

  await page.goto('/')
  await visibleLandingCanvas(page)
  const sticky = page.locator('.landing-sticky-left__canvas')
  const footer = page.locator('#footer-d')

  await expect(sticky).toBeVisible()
  await footer.scrollIntoViewIfNeeded()
  await expect(footer).toBeVisible()

  const overlap = await page.evaluate(() => {
    const stickyNode = document.querySelector('.landing-sticky-left__canvas')
    const footerNode = document.querySelector('#footer-d')
    if (!stickyNode || !footerNode) return null
    const stickyRect = stickyNode.getBoundingClientRect()
    const footerRect = footerNode.getBoundingClientRect()
    return Math.max(0, Math.min(stickyRect.bottom, footerRect.bottom) - Math.max(stickyRect.top, footerRect.top))
  })
  expect(overlap).toBe(0)
  for (const label of ['Explore', 'Company', 'Connect']) {
    await expect(footer.getByText(label, { exact: true })).toBeVisible()
  }

  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }))
  await expect(sticky).toBeVisible()
})

test('landing safety locations and navigation work', async ({ page }) => {
  await page.goto('/')
  const { mode, selector } = await visibleLandingCanvas(page)
  const safety = page.locator(`${selector} .safety-panel`)
  await expect(safety).toBeVisible()
  await expect(safety.getByRole('heading', { name: 'Over 30 million locations worldwide', exact: true })).toBeVisible()
  await expect(safety.locator('.safety-post')).toHaveCount(4)
  await expect(safety.getByRole('link', { name: 'See all', exact: true })).toHaveAttribute('href', '/places')
  await page.locator(`${selector} a[aria-label="Open navigation"]`).click()
  await expect.poll(() => page.evaluate(() => window.location.hash)).toBe(mode === 'desktop' ? '#footer-d' : '#footer-m')
})

test('landing exposes direct auth and legal links', async ({ page }) => {
  await page.goto('/')
  const { mode, stage, authRoot } = await visibleLandingCanvas(page)
  if (mode === 'desktop') {
    expect(await page.locator(`${authRoot} a[href="/signup"]`).count()).toBeGreaterThan(0)
    expect(await page.locator(`${authRoot} a[href="/api/auth/google?next=%2Fdiscover"]`).count()).toBeGreaterThan(0)
  } else {
    await expect(page.locator('.mobile-login-button')).toHaveAttribute('href', '/?mode=login')
  }
  if (await page.locator(`${authRoot} form.landing-login-form`).count()) {
    await expect(page.locator(`${authRoot} form.landing-login-form`)).toHaveAttribute('action', '/api/auth/password')
  }
  for (const path of ['/privacy', '/terms']) expect(await page.locator(`${stage} a[href="${path}"]`).count()).toBeGreaterThan(0)
  await expect(page.locator('button[data-open-app]')).toHaveCount(0)
  await expect(page.locator('[data-open-modal="waitlist"]')).toHaveCount(0)
})

test('landing auth controls expose direct authentication entry points', async ({ page }) => {
  await page.goto('/')
  const { mode, authRoot } = await visibleLandingCanvas(page)
  if (mode === 'desktop') {
    await expect(page.locator(`${authRoot} a[href="/api/auth/google?next=%2Fdiscover"]`).first()).toHaveAttribute('aria-label', 'Continue with Google')
    if (await page.locator(`${authRoot} form.landing-login-form`).count()) {
      await expect(page.locator(`${authRoot} form.landing-login-form`)).toHaveAttribute('method', 'post')
    }
    await page.locator(`${authRoot} a[href="/signup"]:visible`).first().click()
    await expect(page).toHaveURL(/\/signup(?:\?|$)/)
    await expect(page.getByRole('heading', { name: 'Make plans that leave the chat.', level: 1 })).toBeVisible()
  } else {
    await page.locator('.mobile-login-button').click()
    await expect(page.locator('.mobile-login-dialog[open] .landing-login-form')).toBeVisible()
    await page.locator('[data-close-mobile-login]').click()
  }
})

test('404 gives the user a working route home', async ({ page }) => {
  await page.goto('/this-puddle-does-not-exist')
  await expect(page.getByRole('heading', { name: 'This puddle dried up.' })).toBeVisible()
  await expect(page.getByText('404', { exact: true })).toBeVisible()
  await page.getByRole('link', { name: 'Back to Puddle' }).click()
  await expect(page).toHaveURL(/\/$/)
  await visibleLandingCanvas(page)
})
