import { test, expect } from '@playwright/test'

test.beforeEach(async ({ context }) => {
  await context.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort())
})

async function contained(child, parent) {
  const a = await child.boundingBox(), b = await parent.boundingBox()
  expect(a).not.toBeNull()
  expect(b).not.toBeNull()
  expect(a.x).toBeGreaterThanOrEqual(b.x - 1)
  expect(a.y).toBeGreaterThanOrEqual(b.y - 1)
  expect(a.x + a.width).toBeLessThanOrEqual(b.x + b.width + 1)
  expect(a.y + a.height).toBeLessThanOrEqual(b.y + b.height + 1)
}

test('Saved categories do not overlap, More is readable and History is reachable', async ({ page }) => {
  await page.goto('/plans')
  const rail = page.getByRole('navigation', { name: 'Saved categories', exact: true })
  const bounds = await rail.getByRole('link').evaluateAll(nodes => nodes.map(node => ({ left: node.getBoundingClientRect().left, right: node.getBoundingClientRect().right, width: node.clientWidth, scroll: node.scrollWidth })))
  for (let i = 0; i < bounds.length; i++) {
    expect(bounds[i].scroll - bounds[i].width).toBeLessThanOrEqual(1)
    if (i) expect(bounds[i].left).toBeGreaterThanOrEqual(bounds[i - 1].right)
  }
  await page.locator('summary[aria-label="More saved categories"]').click()
  const more = page.getByRole('navigation', { name: 'More saved categories', exact: true })
  await expect(more).toBeVisible()
  for (const link of await more.getByRole('link').all()) {
    await contained(link, more)
    expect((await link.boundingBox()).height).toBeGreaterThanOrEqual(40)
  }
  const title = page.getByTestId('saved-card').nth(2).locator('h2 span')
  expect(await title.evaluate(node => getComputedStyle(node).textOverflow)).toBe('ellipsis')
  await page.getByRole('link', { name: 'History', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'History', exact: true })).toBeVisible()
})

test('Profile category editing reaches its real shared Settings editor', async ({ page }) => {
  await page.goto('/profile')
  const preview = page.locator('.figma-profile-post-preview')
  await expect(preview.getByRole('heading', { name: 'An afternoon outdoors' })).toBeVisible()
  const paragraph = await preview.locator(':scope > p').boundingBox()
  const photo = await preview.locator('.figma-profile-post-collage').boundingBox()
  expect(paragraph.y + paragraph.height).toBeLessThanOrEqual(photo.y)
  await expect(preview.locator('.figma-profile-post-collage > i')).toHaveCount(1)
  await page.getByRole('button', { name: 'Edit favorite categories' }).click()
  const mobile = page.viewportSize().width <= 760
  const editor = mobile ? page : page.frameLocator('iframe[title="Settings"]')
  await expect(editor.locator('#favorite-categories')).toBeVisible()
  await expect(editor.getByRole('checkbox', { name: 'Parks & gardens' })).toBeChecked()
  const context = await editor.locator('form#profile input[name="settings_return"]').inputValue()
  expect(context).toContain(mobile ? 'mobile=1' : 'embedded=1')
  if (mobile) await expect(page.locator('#appearance')).toHaveCount(0)
})

test('legacy full-page mobile Settings navigation scrolls the visible section', async ({ page }) => {
  await page.goto('/account?section=profile')
  await page.getByRole('link', { name: /^Appearance/ }).click()
  await expect(page).toHaveURL(/section=appearance/)
  await expect.poll(async () => {
    const rect = await page.locator('#appearance').boundingBox()
    return rect.y >= -1 && rect.y < page.viewportSize().height
  }).toBe(true)
})

test('streaming product shell restores saved appearance without delaying content', async ({ page }) => {
  let identityReads = 0
  page.on('request', request => { if (request.url().endsWith('/api/profile/identity')) identityReads++ })
  await page.goto('/streaming-shell')
  await expect(page.getByRole('heading', { name: 'Saved appearance' })).toBeVisible()
  await expect(page.locator('.figma-dashboard-shell')).toHaveAttribute('data-resolved-appearance', 'dark')
  await expect(page.locator('.profile-menu-panel strong')).toHaveText('Alex Puddle')
  expect(identityReads).toBe(1)
})

test('shared-place chat action lives in its place card and one photo fills the gallery', async ({ page }) => {
  await page.goto('/matches?tab=shared')
  const places = page.locator('.figma-friends-shared-place')
  await expect(places).toHaveCount(2)
  for (const card of await places.all()) await contained(card.getByRole('button', { name: 'Jump to chat' }), card)
  await page.goto('/discover')
  await page.locator('.figma-swipe-details-button').first().click()
  const gallery = page.locator('.figma-swipe-details-gallery')
  const image = gallery.locator('img')
  await expect(image).toHaveCount(1)
  expect((await image.boundingBox()).width / (await gallery.boundingBox()).width).toBeGreaterThan(.95)
})

test('report fields fit narrow screens and inactive actions explain their state', async ({ page }) => {
  await page.goto('/report?target_type=post&target_id=test')
  const form = page.locator('.report-form')
  await expect(form).toBeVisible()
  for (const field of await form.locator('select,textarea').all()) await contained(field, form)
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1)
  await page.goto('/membership')
  await expect(page.getByRole('button', { name: 'Upgrade', exact: true })).toBeDisabled()
  await expect(page.locator('#upgrade-unavailable')).toContainText('temporarily unavailable')
  await page.goto('/create/post')
  await expect(page.getByText('Posting about', { exact: true })).toBeVisible()
  await expect(page.locator('form[aria-label="Create a puddle post"]')).toContainText('Maple Grove Park')
})

test('map popups remain contained near edges and disappear only when the point leaves', async ({ page }) => {
  await page.goto('/map?view=map')
  const canvas = page.locator('.location-map-canvas')
  await expect(page.locator('.location-map-marker').first()).toBeVisible()
  await page.locator('.location-map-marker').last().click()
  const popup = page.locator('.location-map-side')
  await expect(popup).toBeVisible()
  await contained(popup, canvas)
  if (page.viewportSize().width <= 760) {
    const photo = popup.locator('.location-map-card-photo')
    await expect(photo.locator('img')).toBeVisible()
    expect((await photo.locator('img').boundingBox()).width / (await photo.boundingBox()).width).toBeGreaterThan(.95)
    await expect(popup.locator('.location-map-card-photo-state')).toBeHidden()
  }
  const rect = await canvas.boundingBox()
  await canvas.focus()
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press('ArrowRight')
    if (await popup.isVisible()) await contained(popup, canvas)
  }
  await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height * .8)
  await page.mouse.down()
  await page.mouse.move(rect.x + rect.width * .2, rect.y + rect.height * .8, { steps: 8 })
  if (await popup.isVisible()) await contained(popup, canvas)
  await page.mouse.up()
  if (await popup.isVisible()) await contained(popup, canvas)
  await expect(page.getByText('Loading locations…', { exact: true })).toHaveCount(0)
})

test('a usable map has no loading overlay during a background catalogue request', async ({ page }) => {
  let release, started
  const pending = new Promise(resolve => { release = resolve })
  const requestStarted = new Promise(resolve => { started = resolve })
  await page.route('**/api/map/viewport?**', async route => {
    started()
    await pending
    await route.continue()
  })
  await page.goto('/map?view=map')
  await requestStarted
  await expect(page.locator('.location-map-marker').first()).toBeVisible()
  await expect(page.getByRole('status', { name: 'Loading locations' })).toHaveCount(0)
  await expect(page.getByText('Loading locations…', { exact: true })).toHaveCount(0)
  const response = page.waitForResponse(item => item.url().includes('/api/map/viewport?'))
  release()
  await response
})
