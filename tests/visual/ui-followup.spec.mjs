import { test, expect } from '@playwright/test'

test.beforeEach(async ({ context }) => {
  await context.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort())
})

async function readableInputs(locator) {
  const sizes = await locator.evaluateAll(nodes => nodes.filter(node => node.getBoundingClientRect().width).map(node => parseFloat(getComputedStyle(node).fontSize)))
  expect(sizes.length).toBeGreaterThan(0)
  expect(sizes.every(size => size >= 16), JSON.stringify(sizes)).toBe(true)
}

async function contrast(locator) {
  return locator.evaluate(node => {
    function luminance(value) {
      const channels = value.match(/[\d.]+/g).slice(0, 3).map(Number)
      const linear = channels.map(channel => {
        const v = value.startsWith('rgb') ? channel / 255 : channel
        return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4
      })
      return .2126 * linear[0] + .7152 * linear[1] + .0722 * linear[2]
    }
    let surface = node
    while (surface && ['rgba(0, 0, 0, 0)', 'transparent'].includes(getComputedStyle(surface).backgroundColor)) surface = surface.parentElement
    const a = luminance(getComputedStyle(node).color), b = luminance(getComputedStyle(surface).backgroundColor)
    return (Math.max(a, b) + .05) / (Math.min(a, b) + .05)
  })
}

test('mobile auth returns reveal errors and preserve the requested mode', async ({ page }, info) => {
  test.skip(info.project.use.viewport.width > 760, 'Mobile dialog entry')
  for (const mode of ['signup', 'login', '']) {
    await page.goto(`/landing.html?error=An%20account%20error${mode ? `&mode=${mode}` : ''}`)
    const dialog = page.getByRole('dialog', { name: mode === 'signup' ? 'Sign up' : 'Log in', exact: true })
    await expect(dialog).toBeVisible()
    await expect(dialog.locator('[data-landing-auth-message]:visible')).toHaveText('An account error')
    await expect(dialog.locator(mode === 'signup' ? '.landing-signup-form' : '.landing-login-form')).toBeVisible()
    await readableInputs(dialog.locator('input:not([type=hidden]):not([type=checkbox])'))
  }
})

test('authentication fields stay readable at wider phone and tablet widths', async ({ page }) => {
  await page.goto('/landing.html?mode=login')
  await readableInputs(page.locator('.landing-login-form input:not([type=hidden])'))
  await page.goto('/signup')
  await readableInputs(page.locator('input:not([type=hidden]):not([type=checkbox])'))
})

test('dark-shell cards and labels retain readable contrast', async ({ page }, info) => {
  for (const [path, selector] of [
    ['/recommendations', '.recommendation-settings-card h2'],
    ['/report?target_type=post&target_id=test-post', '.report-form label'],
    ['/appeals', 'label'],
    ['/editor', '.editor-field']
  ]) {
    await page.goto(path)
    const shell = page.locator('.figma-dashboard-shell')
    await expect(shell).toBeVisible()
    await shell.evaluate(node => { node.dataset.appearance = 'dark'; node.dataset.resolvedAppearance = 'dark' })
    for (const label of await page.locator(selector).all()) expect(await contrast(label), `${path}: ${await label.innerText()}`).toBeGreaterThanOrEqual(4.5)
    await page.screenshot({ path: info.outputPath(path.split('?')[0].slice(1) + '-dark.png'), animations: 'disabled' })
  }
})

test('Saved dialog and direct detail both offer Posts and Reviews without premature editing', async ({ page }) => {
  await page.goto('/plans')
  let releaseReviews
  const reviews = new Promise(resolve => { releaseReviews = resolve })
  await page.route('**/api/fixture/reviews', async route => { await reviews; await route.continue() })
  try {
    await page.locator('[data-saved-morph-card] h2 a').first().click()
    const dialog = page.getByRole('dialog', { name: 'Maple Grove Park details' })
    await expect(dialog.getByRole('heading', { name: 'Posts', exact: true })).toBeVisible()
    await expect(dialog.getByRole('link', { name: 'Create post', exact: true })).toHaveAttribute('href', '/create/post?location=visual-place-0')
    await expect(dialog.getByText('Loading reviews…', { exact: true })).toBeVisible()
    await expect(dialog.getByRole('textbox', { name: 'Review', exact: true })).toHaveCount(0)
    releaseReviews()
    await dialog.getByRole('textbox', { name: 'Review', exact: true }).fill('An unsent review')
    await expect(dialog.getByRole('textbox', { name: 'Review', exact: true })).toHaveValue('An unsent review')
    await page.goto('/plans/visual-place-0')
    await expect(page.getByRole('heading', { name: 'Posts', exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Create post', exact: true })).toHaveAttribute('href', '/create/post?location=visual-place-0')
    await expect(page.getByRole('textbox', { name: 'Review', exact: true })).toBeVisible()
  } finally { releaseReviews() }
})

test('composer preview reflects a changed place and preserves the draft', async ({ page }, info) => {
  await page.goto('/create/post')
  await page.getByRole('textbox', { name: 'Title', exact: true }).fill('Unsent title')
  await page.getByRole('button', { name: 'Search saved puddles' }).click()
  await page.getByRole('searchbox', { name: 'Search saved places' }).fill('Last saved place')
  await page.getByRole('button', { name: 'Last saved place Oakville' }).click()
  await expect(page.getByRole('textbox', { name: 'Title', exact: true })).toHaveValue('Unsent title')
  await expect(page.locator('.selectedPlace, [class*="selectedPlace"]')).toContainText('Last saved place')
  if (info.project.use.viewport.width > 760) await expect(page.locator('.figma-create-post-preview-place h2')).toHaveText('Last saved place')
})

test('loading photo controls does not replace the Profile page', async ({ page }, info) => {
  test.skip(!['phone', 'desktop'].includes(info.project.name), 'Lazy loading is independent of extra viewport variants')
  await page.goto('/profile')
  await expect(page.locator('.figma-dashboard-shell')).toHaveAttribute('data-resolved-appearance', /light|dark/)
  let releaseScripts
  const scripts = new Promise(resolve => { releaseScripts = resolve })
  await page.route('**/_next/**/*.js*', async route => { await scripts; await route.continue() })
  try {
    await page.locator('summary[aria-label="Change profile photo"]').click()
    await expect(page.getByRole('status')).toHaveText('Loading photo controls…')
    await expect(page.locator('.figma-profile-screen')).toBeVisible()
    releaseScripts()
    await expect(page.getByLabel('Change photo', { exact: true })).toBeAttached()
    await expect(page.locator('.figma-profile-screen')).toBeVisible()
  } finally { releaseScripts() }
})

test('friend search has explicit empty feedback instead of a silent result', async ({ page }) => {
  await page.goto('/matches?tab=add')
  await page.getByRole('textbox', { name: 'Search friends by name or username' }).fill('No match')
  await page.getByRole('button', { name: 'Search for friends', exact: true }).click()
  await expect(page.getByRole('status')).toHaveText('No matching people. Try another name or username.')
})

test('an appeal network failure is visible and preserves the statement', async ({ page }, info) => {
  test.skip(!['phone', 'desktop'].includes(info.project.name), 'Network recovery is independent of extra viewport variants')
  await page.route('**/api/appeals', route => route.abort())
  await page.goto('/appeals')
  await page.getByRole('textbox', { name: 'Case number', exact: true }).fill('PDL-DEMO')
  await page.getByRole('textbox', { name: 'Statement', exact: true }).fill('An unsent statement to retain after a network failure.')
  await page.getByRole('button', { name: 'Submit appeal', exact: true }).click()
  await expect(page.getByRole('status')).toHaveText(/could not be submitted/)
  await expect(page.getByRole('textbox', { name: 'Statement', exact: true })).toHaveValue('An unsent statement to retain after a network failure.')
  await expect(page.getByRole('button', { name: 'Submit appeal', exact: true })).toBeEnabled()
})

test('Feed actions have distinct share artwork and complete touch targets', async ({ page }) => {
  await page.goto('/map')
  const post = page.getByTestId('feed-post').first()
  const actions = post.locator('footer > a, footer > form > button, footer > details > summary')
  await expect(actions).toHaveCount(4)
  for (const action of await actions.all()) {
    const box = await action.boundingBox()
    expect(box.width).toBeGreaterThanOrEqual(44)
    expect(box.height).toBeGreaterThanOrEqual(44)
  }
  await expect(post.locator('summary[aria-label="Share An afternoon outdoors"] svg circle')).toHaveCount(3)
})

test('address lookup keeps coordinates and recovers from a failed or stale request', async ({ page }, info) => {
  test.skip(!['phone', 'desktop'].includes(info.project.name), 'Request recovery is independent of extra viewport variants')
  await page.route('**/api/security/csrf', route => route.fulfill({ json: { token: 'visual-fixture-only' } }))
  await page.route('**/api/geocode', route => route.abort())
  await page.goto('/editor')
  await page.getByRole('button', { name: 'Find map coordinates', exact: true }).click()
  await expect(page.locator('.geocode-row [role=status]')).toHaveText(/could not be completed/)
  await expect(page.getByRole('spinbutton', { name: 'Latitude', exact: true })).toHaveValue('43.45')
  await expect(page.getByRole('button', { name: 'Find map coordinates', exact: true })).toBeEnabled()
  await page.unroute('**/api/geocode')
  let releaseLookup
  const lookup = new Promise(resolve => { releaseLookup = resolve })
  await page.route('**/api/geocode', async route => { await lookup; await route.fulfill({ json: { result: { latitude: 1, longitude: 2, label: 'Old address' } } }) })
  try {
    await page.getByRole('button', { name: 'Find map coordinates', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Finding coordinates…', exact: true })).toBeDisabled()
    await page.getByRole('textbox', { name: 'Public address or area', exact: true }).fill('A changed address')
    releaseLookup()
    await expect(page.locator('.geocode-row [role=status]')).toHaveText('The address changed. Find its coordinates again.')
    await expect(page.getByRole('spinbutton', { name: 'Latitude', exact: true })).toHaveValue('43.45')
    expect(await contrast(page.locator('.geocode-row span'))).toBeGreaterThanOrEqual(4.5)
  } finally { releaseLookup() }
})

test('photo-removal failure preserves the preview and releases the controls', async ({ page }, info) => {
  test.skip(!['phone', 'desktop'].includes(info.project.name), 'Request recovery is independent of extra viewport variants')
  await page.route('**/api/fixture/remove-photo', route => route.abort())
  await page.goto('/profile')
  await page.locator('summary[aria-label="Change profile photo"]').click()
  await expect(page.getByRole('button', { name: 'Remove', exact: true })).toBeVisible()
  page.once('dialog', dialog => dialog.accept())
  await page.getByRole('button', { name: 'Remove', exact: true }).click()
  await expect(page.getByRole('status')).toHaveText('Could not remove profile picture. Please try again.')
  await expect(page.getByRole('button', { name: 'Remove', exact: true })).toBeEnabled()
  await expect(page.getByRole('img', { name: 'Profile preview', exact: true })).toBeVisible()
})

test('visit forms have readable fields and contrast in both shell themes', async ({ page }) => {
  await page.goto('/visit-plan')
  await readableInputs(page.locator('.visit-plan-form input:not([type=hidden]), .visit-plan-form select, .visit-plan-form textarea'))
  await page.locator('.figma-dashboard-shell').evaluate(node => { node.dataset.appearance = 'dark'; node.dataset.resolvedAppearance = 'dark' })
  for (const label of await page.locator('.visit-plan-form label').all()) expect(await contrast(label)).toBeGreaterThanOrEqual(4.5)
})

test('public header encloses its navigation and mobile sign-in opens the form', async ({ page }) => {
  await page.goto('/public/place')
  const bounds = await page.locator('.public-header').evaluate(node => ({ header: node.getBoundingClientRect().bottom, nav: node.querySelector('nav').getBoundingClientRect().bottom }))
  expect(bounds.nav).toBeLessThanOrEqual(bounds.header)
  await page.getByRole('link', { name: 'Sign in', exact: true }).click()
  await expect(page.locator('.landing-login-form')).toBeVisible()
})

test('embedded landing controls are readable and map pins open their own place', async ({ page }, info) => {
  await page.goto('/landing.html')
  const mobile = info.project.use.viewport.width <= 760
  const section = page.locator(`.feature-card--${mobile ? 'm' : 'd'}-feed`)
  await section.scrollIntoViewIfNeeded()
  const frame = section.locator('iframe').contentFrame()
  await frame.getByRole('button', { name: 'Search puddle', exact: true }).click()
  await readableInputs(frame.getByRole('textbox', { name: 'Search puddle', exact: true }))
  await frame.getByRole('textbox', { name: 'Search puddle', exact: true }).fill('afternoon')
  await expect(frame.getByText('A great place to spend the afternoon', { exact: true })).toBeVisible()
  await frame.getByRole('button', { name: 'Search puddle', exact: true }).click()
  await frame.getByRole('button', { name: 'Map', exact: true }).click()
  await frame.getByRole('button', { name: 'Open Firehall Cool Bar Hot Grill', exact: true }).click()
  await expect(frame.getByRole('dialog', { name: 'Firehall Cool Bar Hot Grill details', exact: true })).toBeVisible()
  await frame.getByRole('button', { name: 'Close details', exact: true }).click()
  await frame.getByRole('button', { name: 'Saved', exact: true }).click()
  await readableInputs(frame.getByRole('textbox', { name: 'Search saved puddles', exact: true }))
  const root = frame.locator('.landing-phone-demo__screen')
  expect(await root.evaluate(node => node.scrollHeight - node.clientHeight)).toBeLessThanOrEqual(1)
  await page.screenshot({ path: info.outputPath('landing-readable-phones.png'), animations: 'disabled' })
})
