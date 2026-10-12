import { test, expect } from '@playwright/test'

test.beforeEach(async ({ context }) => {
  await context.route('**/*', route => ['localhost', '127.0.0.1'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort())
})

test('mobile login survives a desktop breakpoint without an invisible modal', async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 844 })
  await page.goto('/landing.html?mode=signup')
  const dialog = page.getByRole('dialog', { name: 'Sign up', exact: true })
  await expect(dialog).toBeVisible()
  await page.locator('#landing-signup-display-name').fill('Kept name')
  await page.setViewportSize({ width: 844, height: 393 })
  await expect(page.locator('#mobile-login-dialog')).not.toHaveAttribute('open')
  await expect(page.locator('#landing-signup-display-name')).toBeVisible()
  await expect(page.locator('#landing-signup-display-name')).toHaveValue('Kept name')
  await page.getByRole('tab', { name: 'Log in', exact: true }).click()
  await expect(page.locator('.landing-login-form')).toBeVisible()
  await page.setViewportSize({ width: 393, height: 844 })
  await page.locator('[data-mobile-login-trigger]').click()
  await expect(page.getByRole('dialog', { name: 'Log in', exact: true })).toBeVisible()
})

test('signup failure keeps display name and email in the form and can retry', async ({ page }) => {
  let requests = 0
  await page.route('**/api/auth/signup', route => { requests++; return route.fulfill({ status: 400, json: { error: 'Account could not be created.' } }) })
  await page.goto('/landing.html?mode=signup')
  await page.locator('#landing-signup-display-name').fill('Kept name')
  await page.locator('#landing-signup-email').fill('kept@example.test')
  await page.locator('#landing-signup-password').fill('fixture-password')
  await page.locator('.landing-signup-form [name=terms_accepted]').check()
  const submit = page.getByRole('button', { name: 'Create my Puddle' })
  for (let attempt = 0; attempt < 2; attempt++) {
    await submit.click()
    await expect(page.locator('[data-landing-auth-message]:visible')).toContainText('Account could not be created.')
    await expect(submit).toBeEnabled()
    await expect(page.locator('#landing-signup-display-name')).toHaveValue('Kept name')
    await expect(page.locator('#landing-signup-email')).toHaveValue('kept@example.test')
    expect(new URL(page.url()).searchParams.has('email')).toBe(false)
  }
  expect(requests).toBe(2)
  await expect(page.locator('.landing-signup-form .auth-choice--google')).toHaveAttribute('formaction', '/api/auth/google')
})

test('map zoom buttons are visible and operable in every layout', async ({ page }) => {
  await page.goto('/map?view=map')
  const canvas = page.locator('.location-map-canvas')
  await expect(canvas).toBeVisible()
  const initial = Number(await canvas.getAttribute('data-map-zoom'))
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click()
  await expect(canvas).toHaveAttribute('data-map-zoom', String(initial + 1))
  await page.getByRole('button', { name: 'Zoom out', exact: true }).click()
  await expect(canvas).toHaveAttribute('data-map-zoom', String(initial))
})

test('two-finger map zoom accepts the secondary touch and resumes one-finger pan', async ({ page }, info) => {
  test.skip(info.project.name !== 'phone', 'One actual Chromium touch gesture is sufficient')
  await page.goto('/map?view=map')
  const canvas = page.locator('.location-map-canvas')
  await expect(canvas).toBeVisible()
  const bounds = await canvas.boundingBox()
  const initial = Number(await canvas.getAttribute('data-map-zoom'))
  const session = await page.context().newCDPSession(page)
  await session.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 2 })
  const mid = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height * .75 }
  let touching = false
  try {
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ id: 1, x: mid.x - 20, y: mid.y }, { id: 2, x: mid.x + 20, y: mid.y }] })
    touching = true
    await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ id: 1, x: mid.x - 55, y: mid.y }, { id: 2, x: mid.x + 55, y: mid.y }] })
    await expect.poll(async () => Number(await canvas.getAttribute('data-map-zoom'))).toBeGreaterThan(initial)
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    touching = false
    const longitude = await canvas.getAttribute('data-map-center-longitude')
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ id: 1, x: mid.x - 55, y: mid.y }] })
    touching = true
    await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ id: 1, x: mid.x - 75, y: mid.y }] })
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    touching = false
    await expect(canvas).not.toHaveAttribute('data-map-center-longitude', longitude)
  } finally { if (touching) await session.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] }); await session.detach() }
})

test('Saved category menu keeps its final item above the floating search', async ({ page }) => {
  await page.goto('/plans')
  await page.locator('summary[aria-label="More saved categories"]').click()
  const menu = page.getByRole('navigation', { name: 'More saved categories', exact: true })
  const last = menu.getByRole('link').last()
  await last.scrollIntoViewIfNeeded()
  await expect(last).toBeVisible()
  const hit = await last.evaluate(node => {
    const rect = node.getBoundingClientRect()
    return node.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2))
  })
  expect(hit).toBe(true)
  const menuBounds = await menu.boundingBox(), searchBounds = await page.getByRole('search', { name: 'Search saved puddles' }).boundingBox()
  expect(menuBounds.y + menuBounds.height).toBeLessThan(searchBounds.y)
})

test('both Saved Share entry points page and retry without dropping earlier friends', async ({ page }) => {
  const friends = Array.from({ length: 31 }, (_, i) => ({ id: `friend-${i}`, display_name: `Friend ${i + 1}`, sort_name: `friend ${i + 1}` }))
  for (const direct of [false, true]) {
    let failed = false
    await page.route('**/api/fixture/friends*', route => {
      const before = new URL(route.request().url()).searchParams.get('before')
      if (before && !failed) { failed = true; return route.fulfill({ json: { data: null, error: { message: 'Interrupted' } } }) }
      return route.fulfill({ json: { data: before ? friends.slice(30) : friends.slice(0, 30), error: null } })
    })
    await page.goto(direct ? '/plans/visual-place-0' : '/plans')
    if (!direct) {
      await page.locator('[data-saved-morph-card] h2 a').first().click()
      await expect(page.getByRole('dialog').getByRole('button', { name: 'Unsave', exact: true })).toBeEnabled()
    }
    const share = page.locator('details').filter({ has: page.locator('summary[aria-label="Share saved place"]') })
    await share.locator('summary').click()
    await expect(share.getByRole('button', { name: 'Friend 1', exact: true })).toBeVisible()
    await share.getByRole('button', { name: 'More friends', exact: true }).click()
    await expect(share.getByText('Friends could not be loaded.')).toBeVisible()
    await share.getByRole('button', { name: 'Try again', exact: true }).click()
    await expect(share.getByRole('button', { name: 'Friend 31', exact: true })).toBeVisible()
    await expect(share.getByRole('button', { name: 'Friend 1', exact: true })).toHaveCount(1)
    await page.unroute('**/api/fixture/friends*')
  }
})

test('public Save sends the canonical batch with CSRF and recovers from failure', async ({ page }) => {
  await page.route('**/api/security/csrf', route => route.fulfill({ json: { token: 'fixture-only' } }))
  const actions = []
  await page.route('**/api/discovery/actions', route => {
    actions.push(route.request().postDataJSON())
    expect(route.request().headers()['x-puddle-csrf']).toBe('fixture-only')
    return route.fulfill({ status: actions.length === 1 ? 503 : 200, json: actions.length === 1 ? { error: 'Try again' } : { ok: true } })
  })
  await page.goto('/public/place')
  const button = page.getByRole('button', { name: 'Save this place' })
  await button.click()
  await page.getByRole('button', { name: 'Try again', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Saved ✓' })).toBeEnabled()
  expect(actions[0].actions).toHaveLength(1)
  expect(actions[0].actions[0].action).toBe('saved')
  expect(actions[1].actions[0].eventId).toBe(actions[0].actions[0].eventId)
})

test('failed generic upload can reselect the identical file', async ({ page }) => {
  await page.route('**/api/security/csrf', route => route.fulfill({ json: { token: 'fixture-only' } }))
  let requests = 0
  await page.route('**/api/media/upload', route => { requests++; return route.abort() })
  await page.goto('/upload')
  const input = page.locator('input[type=file]')
  for (let attempt = 0; attempt < 2; attempt++) {
    await input.setInputFiles({ name: 'same-file.png', mimeType: 'image/png', buffer: Buffer.from('fixture file') })
    await expect(page.locator('.media-status')).toHaveText('The upload was interrupted. Try again.')
    await expect(input).toBeEnabled()
    expect(await input.evaluate(node => node.files.length)).toBe(0)
  }
  expect(requests).toBe(2)
})

test('linked older Feed post loads directly without clicking More', async ({ page }) => {
  const target = '00000000-0000-4000-8000-000000000011'
  const requests = []
  await page.route('**/api/social-feed*', async route => {
    requests.push(new URL(route.request().url()).searchParams.get('post'))
    const original = await route.fetch()
    const body = await original.json()
    body.items = [{ ...body.items[0], id: target, title: 'Older linked post' }]
    await route.fulfill({ json: body })
  })
  await page.goto(`/map#post-${target}`)
  await expect(page.getByTestId('feed-post').filter({ hasText: 'Older linked post' })).toBeVisible()
  expect(requests.every(id => id === target)).toBe(true)
})

test('light surfaces keep readable ink in dark mode and paid search avoids small text', async ({ page }) => {
  for (const [path, selector] of [['/upload', '.media-uploader h2, .media-drop strong'], ['/create/place', '.pass-location-create-lock h2'], ['/map?view=map', '.location-map-marker span']]) {
    await page.goto(path)
    await expect(page.locator(selector).first()).toBeVisible()
    await page.locator('.figma-dashboard-shell').evaluate(node => { node.dataset.appearance = 'dark'; node.dataset.resolvedAppearance = 'dark' })
    for (const label of await page.locator(selector).all()) {
      const channels = await label.evaluate(node => getComputedStyle(node).color.match(/[\d.]+/g).slice(0, 3).map(Number))
      expect(channels.every(channel => channel < 50), `${path} text must retain dark ink on its light surface`).toBe(true)
    }
  }
  await page.goto('/create/post')
  await page.getByRole('button', { name: 'Choose a place from the map' }).click()
  await expect(page.locator('[class*="mapSelectionNotice"] strong')).toBeVisible()
  await page.locator('.figma-dashboard-shell').evaluate(node => { node.dataset.appearance = 'dark'; node.dataset.resolvedAppearance = 'dark' })
  expect(await page.locator('[class*="mapSelectionNotice"] strong').evaluate(node => getComputedStyle(node).color)).toBe('rgb(17, 17, 17)')
  await page.goto('/paid-search')
  expect(await page.getByRole('textbox', { name: 'Search profiles to message' }).evaluate(node => parseFloat(getComputedStyle(node).fontSize))).toBeGreaterThanOrEqual(16)
})
