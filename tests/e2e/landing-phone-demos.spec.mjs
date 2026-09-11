import { test, expect } from '@playwright/test'

test('landing phone demo routes are public, same-origin frameable, and keep other pages protected from framing', async ({ request }) => {
  const demo = await request.get('/landing-demo/swipe')
  expect(demo.ok()).toBeTruthy()
  expect(demo.headers()['x-frame-options'] || '').toContain('SAMEORIGIN')
  expect(demo.headers()['content-security-policy'] || '').toContain("frame-ancestors 'self'")

  const signup = await request.get('/signup')
  expect(signup.headers()['x-frame-options'] || '').toContain('DENY')
  expect(signup.headers()['content-security-policy'] || '').toContain("frame-ancestors 'none'")
})

test('public Swipe phone keeps the Figma screen identity and real draggable mechanics', async ({ page }) => {
  await page.goto('/landing-demo/swipe')
  const screen = page.locator('[data-demo-screen="swipe"]')
  await expect(screen).toBeVisible()
  await expect(screen).toHaveAttribute('data-figma-screen', '40:641')
  await expect(screen.getByRole('img', { name: 'Puddle' })).toBeVisible()
  const activePhoto = screen.locator('.landing-demo-swipe-card[data-card-role="active"] .landing-demo-swipe-card-photo img')
  await expect(activePhoto).toBeVisible()
  expect(await activePhoto.evaluate((image) => image.naturalWidth)).toBeGreaterThan(0)

  const card = screen.locator('.landing-demo-swipe-card[data-card-role="active"]')
  await expect(card).toHaveAttribute('data-location-id', 'maple-grove')
  await screen.getByRole('button', { name: 'Open Maple Grove Park' }).click()
  await expect(page.getByRole('dialog', { name: 'Full details for Maple Grove Park' })).toBeVisible()
  await page.getByRole('button', { name: 'Close details' }).click()
  const box = await card.boundingBox()
  expect(box).toBeTruthy()
  await page.mouse.move(box.x + box.width * .5, box.y + box.height * .45)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * .86, box.y + box.height * .45, { steps: 8 })
  await page.mouse.up()
  await expect(card).toHaveAttribute('data-location-id', 'firehall')
  await expect(screen.getByRole('button', { name: 'Undo' })).toBeEnabled()
  await screen.getByRole('button', { name: 'Undo' }).click()
  await expect(card).toHaveAttribute('data-location-id', 'maple-grove')
})

test('Saved and Feed phone demos expose their corresponding Figma interactions', async ({ page }) => {
  await page.goto('/landing-demo/save')
  const saved = page.locator('[data-demo-screen="save"]')
  await expect(saved).toBeVisible()
  await expect(saved).toHaveAttribute('data-figma-screen', '25:180')
  await expect(saved.locator('.landing-demo-saved-photo img').first()).toBeVisible()
  const savedImageWidths = await saved.locator('.landing-demo-saved-photo img').evaluateAll((images) => images.map((image) => image.naturalWidth))
  expect(savedImageWidths).toHaveLength(5)
  expect(savedImageWidths.every((width) => width > 0)).toBeTruthy()
  await saved.getByRole('button', { name: 'Plans', exact: true }).click()
  await expect(saved.getByText('Saturday · 7:00 PM')).toBeVisible()
  await expect(saved.getByText('Night Gallery', { exact: true })).toBeVisible()
  await saved.locator('.landing-demo-mobile-header .landing-demo-segment').getByRole('button', { name: 'Saved', exact: true }).click()
  await saved.getByPlaceholder('Search a saved puddle...').fill('film')
  await expect(saved.getByText('Film House', { exact: true })).toBeVisible()
  await expect(saved.getByText('Firehall Cool Bar Hot Grill', { exact: true })).toHaveCount(0)
  await saved.getByText('Film House', { exact: true }).click()
  const savedDialog = page.getByRole('dialog', { name: 'Film House details' })
  await expect(savedDialog).toBeVisible()
  await expect(savedDialog.getByRole('button', { name: 'Close details' })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(savedDialog.getByRole('button', { name: 'Close details' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(savedDialog).toBeHidden()
  await expect(saved.getByRole('link', { name: 'Film House', exact: true })).toBeFocused()

  await page.goto('/landing-demo/feed')
  const feed = page.locator('[data-demo-screen="feed"]')
  await expect(feed).toBeVisible()
  await expect(feed).toHaveAttribute('data-figma-screen', '40:519')
  await expect(feed.getByText('A great place to spend the afternoon', { exact: true })).toBeVisible()
  await expect(feed.locator('.landing-demo-feed-placeVisual img')).toBeVisible()
  const feedImageWidths = await feed.locator('.landing-demo-feed-placeVisual img').evaluateAll((images) => images.map((image) => image.naturalWidth))
  expect(feedImageWidths.every((width) => width > 0)).toBeTruthy()
  await feed.getByRole('button', { name: 'Map', exact: true }).click()
  await expect(feed.getByLabel('Interactive map preview')).toBeVisible()
  await feed.getByRole('button', { name: 'Open Maple Grove Park' }).click()
  await expect(page.getByRole('dialog', { name: 'Maple Grove Park details' })).toBeVisible()
  await page.getByRole('button', { name: 'Close details' }).click()
  await feed.locator('.landing-demo-feed-toolbar .landing-demo-segment').getByRole('button', { name: 'Feed', exact: true }).click()
  await feed.getByRole('button', { name: 'Search puddle', exact: true }).click()
  await feed.getByPlaceholder('Search puddle').fill('not-a-puddle')
  await expect(feed.getByText('No puddles match that search on this page.', { exact: true })).toBeVisible()

})

test('landing embeds the Figma phone set for each responsive composition instead of screenshot placeholders', async ({ page }) => {
  await page.setViewportSize({ width: 1281, height: 900 })
  await page.goto('/')
  await page.waitForFunction(() => document.querySelector('.landing-stage--desktop')?.dataset.ready === 'true')

  for (const demo of ['swipe', 'save', 'feed']) {
    const phone = page.locator(`.landing-canvas--desktop [data-phone-demo="${demo}"]`)
    await expect(phone).toBeAttached()
    await expect(phone.locator('iframe')).toHaveAttribute('data-src', `/landing-demo/${demo}`)
  }
  await expect(page.locator('.landing-canvas--desktop [data-phone-demo="profile"]')).toHaveCount(0)

  const swipePhone = page.locator('.landing-canvas--desktop [data-phone-demo="swipe"]')
  await swipePhone.scrollIntoViewIfNeeded()
  const swipeIframe = swipePhone.locator('iframe')
  await expect(swipeIframe).toHaveAttribute('src', '/landing-demo/swipe', { timeout: 15_000 })
  const swipeFrame = swipeIframe.contentFrame()
  await expect(swipeFrame.locator('[data-demo-screen="swipe"]')).toHaveAttribute('data-figma-screen', '40:641')
  await expect(swipeFrame.getByRole('button', { name: 'Save', exact: true })).toBeEnabled()

  await page.setViewportSize({ width: 704, height: 900 })
  await page.goto('/')
  await page.waitForFunction(() => document.querySelector('.landing-stage--mobile')?.dataset.ready === 'true')
  for (const demo of ['swipe', 'save', 'feed']) {
    const phone = page.locator(`.landing-canvas--mobile [data-phone-demo="${demo}"]`)
    await expect(phone).toBeAttached()
    await expect(phone.locator('iframe')).toHaveAttribute('data-src', `/landing-demo/${demo}`)
  }
  await expect(page.locator('.landing-canvas--mobile [data-phone-demo="profile"]')).toHaveCount(0)

  await expect(page.locator('img.feature-phone[data-draggable-phone]')).toHaveCount(0)
})

test('landing phone demos preserve usable proportions and contain their controls at mobile widths', async ({ page }) => {
  const widths = [320, 375, 393, 430]

  for (const width of widths) {
    await page.setViewportSize({ width, height: Math.round(width * 1.86) })
    await page.goto('/')
    await page.waitForFunction(() => document.querySelector('.landing-stage--mobile')?.dataset.ready === 'true')

    for (const view of ['swipe', 'save', 'feed']) {
      const phone = page.locator(`.landing-canvas--mobile [data-phone-demo="${view}"]`)
      await phone.scrollIntoViewIfNeeded()
      const frameElement = phone.locator('iframe')
      await expect(frameElement).toHaveAttribute('src', `/landing-demo/${view}`, { timeout: 15_000 })
      const frame = frameElement.contentFrame()
      await expect(frame.locator(`[data-demo-screen="${view === 'save' ? 'save' : view}"]`)).toBeVisible()

      const outerGeometry = await phone.evaluate((element) => {
        const card = element.closest('.feature-card')?.getBoundingClientRect()
        const frame = element.getBoundingClientRect()
        return { cardWidth: card?.width || 0, frameWidth: frame.width, frameHeight: frame.height }
      })
      expect(outerGeometry.frameWidth / outerGeometry.cardWidth).toBeGreaterThan(.5)
      expect(outerGeometry.frameHeight / outerGeometry.frameWidth).toBeGreaterThan(1.7)

      const geometry = await frame.locator('.landing-phone-demo__screen').evaluate((screen, currentView) => {
        const bounds = screen.getBoundingClientRect()
        const selector = currentView === 'swipe'
          ? '[data-card-role="active"], .landing-demo-swipe-details-button, .landing-demo-swipe-actions, .landing-demo-bottom-nav'
          : currentView === 'save'
            ? '.landing-demo-saved-categories, .landing-demo-saved-grid, .landing-demo-search, .landing-demo-bottom-nav'
            : '.landing-demo-feed-toolbar, .landing-demo-feed-stream, .landing-demo-compose, .landing-demo-bottom-nav'
        const elements = [...screen.querySelectorAll(selector)].map((element) => {
          const rect = element.getBoundingClientRect()
          return { left: rect.left - bounds.left, right: rect.right - bounds.left, top: rect.top - bounds.top, bottom: rect.bottom - bounds.top, width: rect.width, height: rect.height }
        })
        return { width: bounds.width, height: bounds.height, scrollWidth: screen.scrollWidth, elements }
      }, view)

      expect(geometry.width).toBeGreaterThan(0)
      expect(geometry.height).toBeGreaterThan(0)
      expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.width + 1)
      for (const element of geometry.elements) {
        expect(element.left).toBeGreaterThanOrEqual(-1)
        expect(element.right).toBeLessThanOrEqual(geometry.width + 1)
        expect(element.width).toBeGreaterThan(0)
        expect(element.height).toBeGreaterThan(0)
      }

      if (view === 'swipe') {
        const swipeGeometry = await frame.locator('.landing-demo-swipe-card[data-card-role="active"]').evaluate((card) => {
          const cardBounds = card.getBoundingClientRect()
          const details = card.querySelector('.landing-demo-swipe-details-button')?.getBoundingClientRect()
          return {
            clientWidth: card.clientWidth,
            clientHeight: card.clientHeight,
            scrollHeight: card.scrollHeight,
            details: details
              ? { left: details.left - cardBounds.left, right: details.right - cardBounds.left, top: details.top - cardBounds.top, bottom: details.bottom - cardBounds.top }
              : null
          }
        })
        expect(swipeGeometry.details).toBeTruthy()
        expect(swipeGeometry.details.left).toBeGreaterThanOrEqual(-1)
        expect(swipeGeometry.details.right).toBeLessThanOrEqual(swipeGeometry.clientWidth + 1)
        expect(swipeGeometry.details.bottom).toBeLessThanOrEqual(swipeGeometry.clientHeight + 1)
      }
    }
  }
})
