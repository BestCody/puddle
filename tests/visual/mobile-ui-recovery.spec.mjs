import { test, expect } from '@playwright/test'

const jamieId = '00000000-0000-4000-8000-000000000003'

test.beforeEach(async ({ context }, info) => {
  test.skip(!['small-phone', 'phone', 'desktop'].includes(info.project.name), 'The changed flows cover short phones, regular phones and desktop.')
  await context.route('**/*', route => ['localhost', '127.0.0.1'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort())
})

async function contrast(locator) {
  return locator.evaluate(node => {
    const luminance = color => color.match(/[\d.]+/g).slice(0, 3).map(Number).map(c => c / 255).map(c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4).reduce((sum, c, i) => sum + c * [.2126, .7152, .0722][i], 0)
    let surface = node
    while (getComputedStyle(surface).backgroundColor === 'rgba(0, 0, 0, 0)') surface = surface.parentElement
    const fg = luminance(getComputedStyle(node).color), bg = luminance(getComputedStyle(surface).backgroundColor)
    return (Math.max(fg, bg) + .05) / (Math.min(fg, bg) + .05)
  })
}

test('mobile signup keeps Close visible after scrolling to its last controls', async ({ page }) => {
  test.skip(page.viewportSize().width > 760, 'Only mobile uses the account dialog')
  await page.goto('/landing.html?mode=signup')
  const dialog = page.getByRole('dialog', { name: 'Sign up', exact: true })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('link', { name: 'Continue with email', exact: true }).scrollIntoViewIfNeeded()
  const close = dialog.getByRole('button', { name: 'Close account access' })
  const box = await close.boundingBox()
  expect(box.y).toBeGreaterThanOrEqual(0)
  expect(box.y + box.height).toBeLessThanOrEqual(page.viewportSize().height)
  await close.click()
  await expect(dialog).toBeHidden()
})

test('onboarding exposes one working sign-out form action in both layouts', async ({ page }) => {
  await page.goto('/onboarding')
  const button = page.getByRole('button', { name: 'Sign out', exact: true })
  await expect(button).toHaveCount(1)
  await expect(button).toBeVisible()
  expect(await contrast(button)).toBeGreaterThanOrEqual(4.5)
  expect(await button.evaluate(node => node.type === 'submit' && node.formNoValidate && Boolean(node.form))).toBe(true)
})

test('chat drafts survive Back and remain separate between conversations', async ({ page }) => {
  await page.goto(`/matches?tab=messages&conversation=${jamieId}`)
  const input = page.getByRole('textbox', { name: 'Message', exact: true })
  await input.fill('Draft for Jamie')
  const back = page.getByRole('link', { name: 'Back to conversations' })
  if (await back.isVisible()) await back.click()
  await page.getByRole('button', { name: /Taylor/ }).click()
  await expect(input).toHaveValue('')
  await input.fill('Draft for Taylor')
  if (await back.isVisible()) await back.click()
  await page.getByRole('button', { name: /Jamie/ }).click()
  await expect(input).toHaveValue('Draft for Jamie')
  if (await back.isVisible()) await back.click()
  await page.getByRole('button', { name: /Taylor/ }).click()
  await expect(input).toHaveValue('Draft for Taylor')
})

test('an accepted send does not erase the next message being typed', async ({ page }) => {
  let complete
  const pending = new Promise(resolve => { complete = resolve })
  await page.route('**/api/fixture/send-message', async route => {
    await pending
    await route.fulfill({ json: { data: 'accepted-message', error: null } })
  })
  await page.goto(`/matches?tab=messages&conversation=${jamieId}`)
  const input = page.getByRole('textbox', { name: 'Message', exact: true })
  await input.fill('First message')
  const request = page.waitForRequest('**/api/fixture/send-message')
  await page.getByRole('button', { name: 'Send message', exact: true }).click()
  await request
  await input.fill('Next message')
  complete()
  await expect(page.getByRole('button', { name: 'Send message', exact: true })).toBeEnabled()
  await expect(input).toHaveValue('Next message')
  await page.getByRole('button', { name: 'Send message', exact: true }).click()
  await expect(input).toHaveValue('')
})

test('enabled login, Profile, Swipe labels and paid search have readable contrast', async ({ page }) => {
  await page.goto('/landing.html?mode=login')
  const login = page.locator('.landing-login-form button[type="submit"]').first()
  await expect(login).toBeEnabled()
  expect(await contrast(login)).toBeGreaterThanOrEqual(4.5)
  await page.goto('/profile')
  expect(await contrast(page.getByRole('link', { name: 'Create puddle', exact: true }))).toBeGreaterThanOrEqual(4.5)
  await page.goto('/discover')
  for (const name of ['Save', 'Star']) expect(await contrast(page.getByRole('button', { name, exact: true }).locator('small'))).toBeGreaterThanOrEqual(4.5)
  await page.goto('/paid-search')
  await page.getByRole('textbox', { name: 'Search profiles to message' }).fill('Jamie')
  const search = page.getByRole('button', { name: 'Search', exact: true })
  await expect(search).toBeEnabled()
  expect(await contrast(search)).toBeGreaterThanOrEqual(4.5)
})

test('a popup near the top of the Map clears its measured navigation', async ({ page }) => {
  await page.goto('/map?view=map')
  const canvas = page.getByRole('region', { name: /Interactive map of Puddle locations/ })
  const card = page.locator('.location-map-side > .location-map-card').first()
  await expect(card).toBeVisible()
  const bounds = await canvas.boundingBox(), popup = await card.boundingBox(), header = await page.getByTestId('feed-header').boundingBox()
  const targetY = header.y + header.height + popup.height / 2
  const delta = targetY - (bounds.y + bounds.height / 2)
  await page.mouse.move(bounds.x + bounds.width * .9, bounds.y + bounds.height * .7)
  await page.mouse.down()
  await page.mouse.move(bounds.x + bounds.width * .9, bounds.y + bounds.height * .7 + delta, { steps: 10 })
  await page.mouse.up()
  await expect.poll(async () => (await card.boundingBox()).y).toBeGreaterThanOrEqual(header.y + header.height)
})

test('review failures keep the Saved dialog and its entered rating/body', async ({ page }) => {
  await page.goto('/plans')
  await page.locator('[data-saved-morph-card] h2 a').first().click()
  const dialog = page.getByRole('dialog')
  const body = dialog.getByRole('textbox', { name: 'Review', exact: true })
  await body.fill('Keep this review for another attempt')
  const rating = dialog.getByRole('combobox', { name: 'Your rating', exact: true })
  await rating.selectOption('4')
  for (let attempt = 0; attempt < 2; attempt++) {
    await dialog.getByRole('button', { name: 'Post review', exact: true }).click()
    await expect(dialog.getByRole('alert')).toContainText(/unavailable|could not/)
    await expect(body).toHaveValue('Keep this review for another attempt')
    await expect(rating).toHaveValue('4')
    await expect(page).toHaveURL(/\/plans$/)
  }
})

test('visit and claim errors retain the current form through repeated retries', async ({ page }) => {
  await page.goto('/visit-plan')
  const note = page.getByRole('textbox', { name: /Note/ })
  const visitForm = page.locator('form').filter({ has: note })
  await note.fill('Bring a sketchbook')
  await page.getByRole('combobox', { name: 'Status' }).selectOption('visited')
  for (let attempt = 0; attempt < 2; attempt++) {
    await page.getByRole('button', { name: 'Save visit', exact: true }).click()
    await expect(visitForm.getByRole('alert')).toContainText(/no longer|could not/)
    await expect(note).toHaveValue('Bring a sketchbook')
    await expect(page.getByRole('combobox', { name: 'Status' })).toHaveValue('visited')
    await expect(page).toHaveURL(/\/visit-plan$/)
  }
  await page.goto('/claim')
  const relationship = page.getByRole('textbox', { name: 'Your relationship', exact: true })
  await relationship.fill('Venue manager')
  const evidence = page.getByRole('textbox', { name: 'Verification link', exact: true })
  await evidence.fill('https://example.test')
  const context = page.getByRole('textbox', { name: 'Additional context', exact: true })
  const claimForm = page.locator('form').filter({ has: relationship })
  await context.fill('Keep this explanation')
  for (let attempt = 0; attempt < 2; attempt++) {
    await page.getByRole('button', { name: /Submit claim/ }).click()
    await expect(claimForm.getByRole('alert')).toContainText(/not available|could not/)
    await expect(relationship).toHaveValue('Venue manager')
    await expect(evidence).toHaveValue('https://example.test')
    await expect(context).toHaveValue('Keep this explanation')
    await expect(page).toHaveURL(/\/claim$/)
  }
})

test('Profile post preview links resolve a specific Feed post', async ({ page }) => {
  let requestedPost
  await page.route('**/api/social-feed*', async route => {
    requestedPost = new URL(route.request().url()).searchParams.get('post')
    await route.continue()
  })
  await page.goto('/profile')
  const preview = page.locator('.figma-profile-post-preview')
  const id = '00000000-0000-4000-8000-000000000020'
  await expect(preview).toHaveAttribute('href', `/map#post-${id}`)
  await preview.click()
  await expect(page.locator(`#post-${id}`)).toBeVisible()
  expect(requestedPost).toBe(id)
})
