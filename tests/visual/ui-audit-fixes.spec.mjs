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

for (const [route, label, content] of [
  ['/plans', 'More saved categories', 'nav[aria-label="More saved categories"]'],
  ['/create/post', 'Open add menu', '.figma-create-post-add-menu']
]) test(`a native ${label} menu opened before hydration remains usable afterward`, async ({ page }, testInfo) => {
  test.skip(!['phone', 'desktop'].includes(testInfo.project.name), 'The hydration race is viewport-independent; cover phone and desktop.')
  let releaseScripts
  const scripts = new Promise(resolve => { releaseScripts = resolve })
  await page.route('**/_next/**/*.js*', async request => { await scripts; await request.continue() })
  try {
    await page.goto(route, { waitUntil: 'commit' })
    const toggle = page.locator(`summary[aria-label="${label}"]`)
    await toggle.click()
    await expect(page.locator(content)).toBeVisible()
    releaseScripts()
    await expect(page.locator('.figma-dashboard-shell')).toHaveAttribute('data-resolved-appearance', /light|dark/)
    await expect(page.locator(content)).toBeVisible()
    if (route === '/create/post') await expect(page.locator('.figma-create-post-location-options').getByRole('link')).toHaveCount(12)
    if (route === '/plans') await page.getByRole('searchbox', { name: 'Search saved puddles' }).click()
    else await page.getByRole('textbox', { name: 'Title', exact: true }).focus()
    await expect(page.locator(content)).toBeHidden()
    await toggle.click()
    await page.keyboard.press('Escape')
    await expect(page.locator(content)).toBeHidden()
    await expect(toggle).toBeFocused()
  } finally {
    releaseScripts()
  }
})

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
  await more.getByRole('link').first().focus()
  await page.keyboard.press('Escape')
  await expect(more).toBeHidden()
  const toggle = page.locator('summary[aria-label="More saved categories"]')
  await expect(toggle).toBeFocused()
  await toggle.click()
  await page.getByRole('searchbox', { name: 'Search saved puddles' }).click()
  await expect(more).toBeHidden()
  const title = page.getByTestId('saved-card').nth(2).locator('h2 span')
  expect(await title.evaluate(node => getComputedStyle(node).textOverflow)).toBe('ellipsis')
  await page.getByRole('link', { name: 'History', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'History', exact: true })).toBeVisible()
})

test('Saved detail surfaces and text follow the shell theme, including mobile panels', async ({ page }, testInfo) => {
  await page.goto('/plans')
  await expect(page.locator('.figma-dashboard-shell')).toHaveAttribute('data-resolved-appearance', /light|dark/)
  if (testInfo.project.name.endsWith('-dark')) await page.locator('.figma-dashboard-shell').evaluate(node => {
    node.dataset.appearance = 'dark'
    node.dataset.resolvedAppearance = 'dark'
  })
  const surface = await page.getByTestId('saved-card').first().evaluate(node => getComputedStyle(node).backgroundColor)
  await page.locator('[data-saved-morph-card] h2 a').first().click()
  const dialog = page.getByRole('dialog', { name: 'Maple Grove Park details' })
  await expect(dialog.getByRole('button', { name: 'Pin', exact: true })).toBeEnabled()
  const card = dialog.locator('.saved-inline-detail-card')
  await expect.poll(() => card.evaluate(node => getComputedStyle(node).backgroundColor)).toBe(surface)
  const text = await card.evaluate(node => getComputedStyle(node).color)
  // Similar-place headings can disappear when their lazy request returns no
  // results. Snapshot the rendered styles atomically, rather than retaining
  // nth-locators that can point past the end of the updated heading list.
  const headingColors = await dialog.locator('.saved-inline-detail-main h1, .saved-inline-detail-main h2, .saved-inline-detail-similar h2').evaluateAll(nodes => nodes.map(node => getComputedStyle(node).color))
  expect(headingColors.length).toBeGreaterThanOrEqual(3)
  for (const color of headingColors) expect(color).toBe(text)
  await page.screenshot({ path: testInfo.outputPath('saved-detail-theme.png'), animations: 'disabled' })
  await dialog.locator('.saved-inline-detail-map').scrollIntoViewIfNeeded()
  const attribution = dialog.locator('.location-map-attribution')
  await expect(attribution).toBeVisible()
  const contrast = await attribution.evaluate(node => {
    function luminance(value) {
      const channels = value.match(/[\d.]+/g).slice(0, 3).map(Number)
      const linear = channels.map(channel => {
        const normalized = value.startsWith('rgb') ? channel / 255 : channel
        return normalized <= .04045 ? normalized / 12.92 : ((normalized + .055) / 1.055) ** 2.4
      })
      return .2126 * linear[0] + .7152 * linear[1] + .0722 * linear[2]
    }
    const style = getComputedStyle(node)
    const a = luminance(style.color), b = luminance(style.backgroundColor)
    return (Math.max(a, b) + .05) / (Math.min(a, b) + .05)
  })
  expect(contrast).toBeGreaterThanOrEqual(4.5)
})

test('Saved sharing dismisses its own menu before the enclosing dialog', async ({ page }) => {
  await page.goto('/plans')
  await expect(page.locator('.figma-dashboard-shell')).toHaveAttribute('data-resolved-appearance', /light|dark/)
  const source = page.locator('[data-saved-morph-card] h2 a').first()
  await source.click()
  const dialog = page.getByRole('dialog', { name: 'Maple Grove Park details' })
  await expect(dialog.getByRole('button', { name: 'Pin', exact: true })).toBeEnabled()
  const share = dialog.locator('summary').filter({ hasText: 'Share' })
  await share.click()
  await expect(dialog.getByRole('button', { name: 'Alex Puddle', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Alex Puddle', exact: true })).toBeHidden()
  await expect(share).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(source).toBeFocused()
})

test('Feed comment menu dismisses without losing its unsent draft', async ({ page }) => {
  await page.goto('/map')
  const post = page.getByTestId('feed-post').first()
  const comment = post.getByLabel('Comment on An afternoon outdoors')
  await comment.click()
  await post.getByRole('textbox', { name: 'Add a comment' }).fill('Unsent draft')
  await page.keyboard.press('Escape')
  await expect(post.getByRole('textbox', { name: 'Add a comment' })).toBeHidden()
  await expect(comment).toBeFocused()
  await comment.click()
  await expect(post.getByRole('textbox', { name: 'Add a comment' })).toHaveValue('Unsent draft')
  await page.getByRole('button', { name: 'Search posts', exact: true }).click()
  await expect(post.getByRole('textbox', { name: 'Add a comment' })).toBeHidden()
})

test('Profile photo menu dismisses and concise Settings keeps its accessible name', async ({ page }) => {
  await page.goto('/profile')
  if (page.viewportSize().width > 760) await expect(page.getByRole('complementary', { name: 'Puddle sidebar' }).getByRole('button', { name: 'Settings', exact: true })).toBeVisible()
  const toggle = page.locator('summary[aria-label="Change profile photo"]')
  await toggle.click()
  await expect(page.getByRole('button', { name: 'Remove', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: 'Remove', exact: true })).toBeHidden()
  await expect(toggle).toBeFocused()
  await toggle.click()
  await page.getByRole('heading', { name: 'Alex Puddle', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Remove', exact: true })).toBeHidden()
})

test('Create Post place picker dismisses without resetting draft fields', async ({ page }) => {
  await page.goto('/create/post')
  await page.getByRole('textbox', { name: 'Title', exact: true }).fill('Unsent title')
  const toggle = page.locator('summary[aria-label="Open add menu"]')
  await toggle.click()
  await expect(page.getByText('Attach a place', { exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByText('Attach a place', { exact: true })).toBeHidden()
  await expect(toggle).toBeFocused()
  await expect(page.getByRole('textbox', { name: 'Title', exact: true })).toHaveValue('Unsent title')
})

test('conversation menus dismiss independently and preserve the unsent message', async ({ page }) => {
  await page.goto('/matches?tab=messages&conversation=00000000-0000-4000-8000-000000000003')
  const message = page.getByRole('textbox', { name: 'Message', exact: true })
  await message.fill('Unsent message')
  const more = page.locator('summary[aria-label="More message options"]')
  await more.click()
  await expect(page.getByRole('link', { name: 'View shared puddles', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('link', { name: 'View shared puddles', exact: true })).toBeHidden()
  await expect(more).toBeFocused()
  const attach = page.locator('summary[aria-label="Add a place"]')
  await attach.click()
  await expect(page.getByText('Share a saved place', { exact: true })).toBeVisible()
  await message.click()
  await expect(page.getByText('Share a saved place', { exact: true })).toBeHidden()
  await expect(message).toHaveValue('Unsent message')
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
