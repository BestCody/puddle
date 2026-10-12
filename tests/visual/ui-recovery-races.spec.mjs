import { test, expect } from '@playwright/test'

test.beforeEach(async ({ context }) => {
  await context.route('**/*', route => ['localhost', '127.0.0.1'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort())
})

test('composer traps both Tab directions with a closed and open native picker', async ({ page }) => {
  await page.goto('/map')
  await page.getByRole('button', { name: /Create a puddle/ }).click()
  const dialog = page.getByRole('dialog', { name: 'Create a puddle', exact: true })
  const picker = dialog.locator('summary')
  await picker.focus()
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press('Tab')
    expect(await dialog.evaluate(node => node.contains(document.activeElement))).toBe(true)
  }
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press('Shift+Tab')
    expect(await dialog.evaluate(node => node.contains(document.activeElement))).toBe(true)
  }
  await picker.click()
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press('Tab')
    expect(await dialog.evaluate(node => node.contains(document.activeElement))).toBe(true)
  }
})

test('onboarding footer stays below Birth Date and remains scroll-reachable', async ({ page }) => {
  await page.goto('/onboarding')
  const birth = page.getByRole('textbox', { name: /Birth Date/i })
  const next = page.getByRole('button', { name: 'Next step', exact: true })
  await next.scrollIntoViewIfNeeded()
  const field = await birth.boundingBox(), button = await next.boundingBox()
  expect(button.y).toBeGreaterThanOrEqual(field.y + field.height)
  expect(button.y + button.height).toBeLessThanOrEqual(page.viewportSize().height)
})

async function contrast(locator) {
  return locator.evaluate(node => {
    const rgb = value => value.match(/[\d.]+/g).slice(0, 3).map(Number)
    const luminance = value => rgb(value).map(c => c / 255).map(c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4).reduce((sum, c, index) => sum + c * [.2126, .7152, .0722][index], 0)
    const style = getComputedStyle(node)
    let surface = node
    while (getComputedStyle(surface).backgroundColor === 'rgba(0, 0, 0, 0)') surface = surface.parentElement
    const foreground = luminance(style.color), background = luminance(getComputedStyle(surface).backgroundColor)
    return (Math.max(foreground, background) + .05) / (Math.min(foreground, background) + .05)
  })
}

test('Shared CTA and every Map popup text action have readable contrast', async ({ page }) => {
  await page.goto('/matches?tab=shared')
  const shared = page.locator('.figma-friends-shared-chat-action').first()
  await expect(shared).toBeVisible()
  expect(await contrast(shared)).toBeGreaterThanOrEqual(4.5)
  await page.goto('/map?view=map')
  await page.locator('.location-map-marker').last().click()
  const card = page.locator('.location-map-card').first()
  await expect(card).toBeVisible()
  for (const text of await card.locator('h2, .location-map-card-actions a, .location-map-card-actions button').all()) {
    expect(await contrast(text)).toBeGreaterThanOrEqual(4.5)
  }
})

test.describe('state and retry recovery', () => {
test.beforeEach(async ({}, info) => {
  test.skip(!['phone', 'desktop'].includes(info.project.name), 'Request recovery covers both distinct layouts; geometry is tested at every breakpoint above')
})

test('late Saved mutation cannot replace a newly opened place or clear its pending state', async ({ page }) => {
  let completeFirst, completeSecond
  const waiting = new Promise(resolve => { completeFirst = resolve })
  const secondWaiting = new Promise(resolve => { completeSecond = resolve })
  await page.route('**/api/saved-location/*', async route => {
    const slug = new URL(route.request().url()).pathname.split('/').at(-1)
    const location = { id: slug, slug, name: slug === 'visual-place-0' ? 'Place A' : 'Place B', city: 'Oakville', gallery: [] }
    if (route.request().method() === 'POST' && slug === 'visual-place-0') await waiting
    if (route.request().method() === 'POST' && slug === 'visual-place-1') await secondWaiting
    return route.fulfill({ json: { ok: true, location, state: { saved: true, pinned: route.request().method() === 'POST' }, posts: [], similar: [] } })
  })
  await page.goto('/plans')
  await page.locator('[data-saved-morph-card] h2 a').nth(0).click()
  let dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('heading', { name: 'Place A', exact: true })).toBeVisible()
  const request = page.waitForRequest(req => req.method() === 'POST' && req.url().includes('/saved-location/visual-place-0'))
  await dialog.getByRole('button', { name: 'Pin', exact: true }).click()
  await request
  await dialog.getByRole('button', { name: 'Close saved details', exact: true }).last().click()
  await expect(dialog).toHaveCount(0)
  await page.locator('[data-saved-morph-card] h2 a').nth(1).click()
  dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('heading', { name: 'Place B', exact: true })).toBeVisible()
  const secondRequest = page.waitForRequest(req => req.method() === 'POST' && req.url().includes('/saved-location/visual-place-1'))
  await dialog.getByRole('button', { name: 'Pin', exact: true }).click()
  await secondRequest
  const firstResponse = page.waitForResponse(response => response.request().method() === 'POST' && response.url().includes('/saved-location/visual-place-0'))
  completeFirst()
  await firstResponse
  await expect(dialog.getByRole('button', { name: 'Pin', exact: true })).toBeDisabled()
  await expect(dialog.getByRole('heading', { name: 'Place B', exact: true })).toBeVisible()
  await expect(dialog.getByRole('heading', { name: 'Place A', exact: true })).toHaveCount(0)
  completeSecond()
  await expect(dialog.getByRole('button', { name: 'Unpin', exact: true })).toBeEnabled()
})

test('interrupted Saved share retries reuse the same idempotency key', async ({ page }) => {
  const requests = []
  await page.route('**/api/saved-location/*', async route => {
    if (route.request().method() !== 'POST') return route.continue()
    requests.push(route.request().postDataJSON())
    if (requests.length === 1) return route.abort('failed')
    const response = await page.request.get(route.request().url())
    return route.fulfill({ json: { ok: true, ...await response.json() } })
  })
  await page.goto('/plans')
  await page.locator('[data-saved-morph-card] h2 a').first().click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('button', { name: 'Pin', exact: true })).toBeEnabled()
  await dialog.locator('summary').filter({ hasText: 'Share' }).click()
  const friend = dialog.getByRole('button', { name: 'Alex Puddle', exact: true })
  await friend.click()
  await expect(dialog.getByRole('status')).toContainText('could not be completed')
  await expect(friend).toBeEnabled()
  await friend.click()
  await expect(dialog.getByRole('status')).toHaveText('Shared.')
  expect(requests).toHaveLength(2)
  expect(requests[1].share_key).toBe(requests[0].share_key)
})

test('Undo and Filters are unavailable only while the card departs', async ({ page }) => {
  await page.route('**/api/security/csrf', route => route.fulfill({ json: { token: 'fixture' } }))
  await page.route('**/api/discovery/actions', route => route.fulfill({ json: { ok: true } }))
  await page.goto('/discover')
  const pass = page.getByRole('button', { name: 'Pass', exact: true })
  await pass.click()
  await expect(page.getByRole('button', { name: 'Open filters' })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled()
  await page.keyboard.press('u')
  await expect(page.locator('.figma-swipe-card:not(.is-preview)')).toHaveAttribute('data-location-id', 'visual-place-1')
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeEnabled()
  await expect(page.getByRole('button', { name: 'Open filters' })).toBeEnabled()
})

test('replacing a departing card cancels its delayed decision', async ({ page }) => {
  await page.goto('/swipe-cancel')
  await page.getByRole('button', { name: 'Start departure' }).click()
  await expect(page.locator('.figma-swipe-card')).toHaveClass(/is-leaving/)
  await page.getByRole('button', { name: 'Replace departing card' }).click()
  await expect(page.getByText('Replacement card', { exact: true })).toBeVisible()
  // Advance past the real animation completion; no discarded card may commit.
  await page.waitForTimeout(400)
  await expect(page.getByLabel('Committed choices')).toHaveText('0')
})

test('standalone signup errors preserve fields and consent without putting secrets in URLs', async ({ page }) => {
  await page.goto('/signup')
  await page.getByRole('textbox', { name: 'Display name', exact: true }).fill('Kept name')
  await page.getByRole('textbox', { name: 'Email', exact: true }).fill('kept@example.test')
  await page.locator('input[name="password"]').fill('fixture-password')
  const consent = page.locator('form').filter({ has: page.locator('input[name="display_name"]') }).getByRole('checkbox')
  await consent.check()
  for (let i = 0; i < 2; i++) {
    await page.getByRole('button', { name: 'Create my Puddle' }).click()
    await expect(page.locator('form').filter({ has: page.locator('input[name="display_name"]') }).getByRole('alert')).toContainText('could not create your account')
    await expect(page.getByRole('textbox', { name: 'Display name', exact: true })).toHaveValue('Kept name')
    await expect(page.getByRole('textbox', { name: 'Email', exact: true })).toHaveValue('kept@example.test')
    await expect(page.locator('input[name="password"]')).toHaveValue('fixture-password')
    await expect(consent).toBeChecked()
    await expect(page).toHaveURL(/\/signup$/)
  }
})

test('conversation selection exposes opening and pagination failures', async ({ page }, info) => {
  test.skip(!['phone', 'small-phone'].includes(info.project.name), 'Mobile selection is the affected surface')
  await page.route('**/api/fixture/open-conversation', route => route.fulfill({ json: { error: { message: 'Unavailable' } } }))
  await page.route('**/api/fixture/conversations', route => route.fulfill({ json: { error: { message: 'Unavailable' } } }))
  await page.goto('/messages-recovery')
  await page.getByRole('button', { name: /New friend/ }).click()
  await expect(page.getByRole('status')).toContainText(/could not open/i)
  await page.getByRole('button', { name: 'Load more conversations' }).click()
  await expect(page.getByRole('status')).toContainText('More conversations could not be loaded.')
})

test('Feed sharing retries the failed cursor without dropping loaded friends', async ({ page }) => {
  const friends = Array.from({ length: 31 }, (_, i) => ({ id: `friend-${i}`, display_name: `Friend ${i + 1}`, sort_name: `friend ${i + 1}` }))
  const cursors = []
  await page.route('**/api/fixture/friends*', route => {
    const before = new URL(route.request().url()).searchParams.get('before')
    cursors.push(before)
    if (cursors.length === 2) return route.fulfill({ json: { error: { message: 'Unavailable' } } })
    return route.fulfill({ json: { data: before ? friends.slice(30) : friends.slice(0, 30), error: null } })
  })
  await page.goto('/map')
  const share = page.locator('details').filter({ has: page.locator('summary[aria-label="Share An afternoon outdoors"]') }).first()
  await share.locator('summary').click()
  await expect(share.getByRole('button', { name: 'Friend 1', exact: true })).toBeVisible()
  await share.getByRole('button', { name: 'More friends' }).click()
  await share.getByRole('button', { name: 'Try again' }).click()
  await expect(share.getByRole('button', { name: 'Friend 31' })).toBeVisible()
  await expect(share.getByRole('button', { name: 'Friend 1', exact: true })).toHaveCount(1)
  expect(cursors).toEqual(['', 'friend-29', 'friend-29'])
})

test('appeal and verification retries acquire fresh single-use challenges even after 403', async ({ page }) => {
  await page.addInitScript(() => {
    let sequence = 0
    window.turnstile = {
      render(selector, options) {
        const token = `fixture-challenge-${++sequence}`
        document.querySelector(selector).dataset.testToken = token
        queueMicrotask(() => options.callback(token))
        return token
      },
      remove() {}
    }
  })
  await page.route('**/api/security/csrf', route => route.fulfill({ json: { token: 'fixture' } }))
  for (const kind of ['appeals', 'verification-upload']) {
    const tokens = []
    const endpoint = kind === 'appeals' ? '**/api/appeals' : '**/api/media/upload'
    await page.route(endpoint, route => {
      const body = route.request().postData()
      tokens.push(kind === 'appeals' ? JSON.parse(body).turnstileToken : body.match(/fixture-challenge-\d+/)?.[0])
      return route.fulfill({ status: 403, json: { error: 'Please retry this request.' } })
    })
    await page.goto(`/${kind}`)
    if (kind === 'appeals') {
      await page.getByRole('textbox', { name: 'Case number' }).fill('PDL-test-case')
      await page.getByRole('textbox', { name: 'Statement' }).fill('Keep this appeal statement through retries.')
    }
    for (let attempt = 0; attempt < 2; attempt++) {
      await expect(page.locator('[data-test-token]')).toHaveCount(1)
      const oldToken = await page.locator('[data-test-token]').getAttribute('data-test-token')
      if (kind === 'appeals') await page.getByRole('button', { name: 'Submit appeal' }).click()
      else await page.locator('input[type="file"]').setInputFiles({ name: 'retry.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 fixture') })
      await expect(page.locator('[data-test-token]')).not.toHaveAttribute('data-test-token', oldToken)
    }
    expect(tokens).toHaveLength(2)
    expect(tokens[0]).toBeTruthy()
    expect(tokens[1]).not.toBe(tokens[0])
    if (kind === 'appeals') await expect(page.getByRole('textbox', { name: 'Statement' })).toHaveValue('Keep this appeal statement through retries.')
    await page.unroute(endpoint)
  }
})
})
