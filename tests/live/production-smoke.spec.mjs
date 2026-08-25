import { test, expect } from '@playwright/test'
import sharp from 'sharp'

async function deleteDisposableAccount(page) {
  try {
    await page.goto('/account', { waitUntil: 'domcontentloaded', timeout: 30_000 })
    if (!/\/account(?:\?|$)/.test(page.url())) return
    const confirmation = page.locator('input[name="confirmation"]')
    if (!(await confirmation.isVisible().catch(() => false))) return
    await confirmation.fill('DELETE')
    await Promise.all([
      page.waitForURL((url) => url.pathname === '/' && url.searchParams.get('account') === 'deleted', { timeout: 30_000 }),
      page.getByRole('button', { name: 'Delete my account' }).click()
    ])
  } catch {
    // Cleanup is best-effort; the smoke assertions remain authoritative.
  }
}

test('production Figma core UI, share, profile photo, and Stripe handoff work end to end', async ({ page, request }) => {
  test.setTimeout(150_000)
  const suffix = `${Date.now().toString(36)}${crypto.randomUUID().replaceAll('-', '').slice(0, 8)}`
  const email = `puddle-live-${suffix}@example.com`
  const password = `LiveSmoke-${suffix}-A9!`
  const username = `live_${suffix}`.slice(0, 24)
  let accountCreated = false

  await page.route('**/api/location/search?**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        results: [{
          providerId: 'live-smoke-toronto',
          city: 'Toronto',
          region: 'Ontario',
          country: 'Canada',
          countryCode: 'CA',
          latitude: 43.6532,
          longitude: -79.3832,
          timezone: 'America/Toronto',
          label: 'Toronto, Ontario, Canada'
        }]
      })
    })
  })

  try {
    await page.goto('/signup')
    await page.getByLabel('Display name').fill('Puddle Live Smoke')
    await page.getByLabel('Email').fill(email)
    await page.getByLabel('Password').fill(password)
    await page.getByRole('checkbox', { name: /confirm the information I/i }).check()
    await page.getByRole('button', { name: 'Create my Puddle →' }).click()
    await page.waitForURL(/\/onboarding(?:\?|$)/, { timeout: 30_000 })
    accountCreated = true

    await page.locator('input[name="username"]').fill(username)
    await page.locator('input[name="birth_date"]').fill('1990-01-01')
    await page.getByLabel('City or town').fill('Toronto')
    await page.getByRole('button', { name: 'Search', exact: true }).click()
    await page.getByRole('option').filter({ hasText: 'Toronto' }).click()
    await page.getByRole('checkbox', { name: 'Coffee shops' }).check()
    await page.getByRole('checkbox', { name: 'Restaurants' }).check()
    await page.getByRole('checkbox', { name: 'Parks & gardens' }).check()
    await page.getByRole('button', { name: 'Build my date deck →' }).click()
    await page.waitForURL(/\/discover(?:\?|$)/, { timeout: 30_000 })
    await expect(page.locator('.minimal-swipe-card')).toBeVisible({ timeout: 30_000 })
    for (const name of ['Back', 'Pass', 'Save', 'Star']) await expect(page.getByRole('button', { name })).toBeVisible()

    const filterButton = page.getByRole('button', { name: 'Open filters' })
    const shareButton = page.getByRole('button', { name: 'Send to' })
    await expect(filterButton).toBeVisible()
    await expect(shareButton).toBeVisible()
    const filterBox = await filterButton.boundingBox()
    const shareBox = await shareButton.boundingBox()
    expect(filterBox).toBeTruthy()
    expect(shareBox).toBeTruthy()
    expect(Math.abs((shareBox.y + shareBox.height / 2) - (filterBox.y + filterBox.height / 2))).toBeLessThanOrEqual(8)
    await shareButton.click()
    await expect(page.getByRole('heading', { name: 'Send to' })).toBeVisible()
    await page.getByRole('button', { name: 'Close' }).click()

    await page.goto('/map')
    const feedTabs = page.locator('.figma-feed-segment')
    await expect(feedTabs.getByRole('link', { name: 'Feed', exact: true })).toBeVisible()
    await feedTabs.getByRole('link', { name: 'Map', exact: true }).click()
    await expect(page).toHaveURL(/\/map\?view=map/)
    await expect(page.locator('.figma-map-view')).toBeVisible()

    await page.goto('/plans')
    const savedTabs = page.locator('.figma-saved-segment')
    await expect(savedTabs.getByRole('link', { name: 'Saved', exact: true })).toBeVisible()
    await savedTabs.getByRole('link', { name: 'Plans', exact: true }).click()
    await expect(page).toHaveURL(/\/plans\?tab=planned/)

    await page.goto('/matches')
    await expect(page.locator('.social-messages-layout')).toBeVisible()
    const socialTabs = page.locator('.social-tabs button')
    await expect(socialTabs).toHaveCount(3)
    await socialTabs.nth(2).click()
    await expect(page).toHaveURL(/\/matches\?tab=shared/)

    await page.goto('/profile')
    const imageBuffer = await sharp({
      create: { width: 96, height: 96, channels: 3, background: { r: 238, g: 70, b: 122 } }
    }).png().toBuffer()
    await page.locator('.profile-photo-editor input[type="file"]').setInputFiles({
      name: 'live-profile-test.png',
      mimeType: 'image/png',
      buffer: imageBuffer
    })
    await expect(page.getByAltText('Profile preview')).toBeVisible()
    await page.getByRole('button', { name: 'Save photo' }).click()
    await expect(page.getByText('Profile picture updated.')).toBeVisible({ timeout: 30_000 })

    await page.reload()
    const profileImage = page.locator('.minimal-profile-avatar img')
    await expect(profileImage).toBeVisible()
    await expect.poll(async () => profileImage.evaluate((image) => image.complete && image.naturalWidth > 0)).toBeTruthy()
    const src = await profileImage.getAttribute('src')
    expect(src).toBeTruthy()
    const imageResponse = await request.get(src)
    expect(imageResponse.ok()).toBeTruthy()
    expect(imageResponse.headers()['content-type'] || '').toMatch(/^image\//)
    const persisted = await imageResponse.body()
    const stats = await sharp(persisted).stats()
    expect(stats.channels[0].mean).toBeGreaterThan(stats.channels[1].mean + 80)
    expect(stats.channels[0].mean).toBeGreaterThan(stats.channels[2].mean + 50)

    await page.goto('/account')
    await expect(page.locator('.figma-settings-page')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Profile settings' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Billing' })).toHaveAttribute('href', '/membership?view=manage')

    await page.goto('/membership')
    await expect(page.locator('.figma-pass-title')).toContainText('Membership')
    const checkoutButton = page.getByRole('button', { name: 'Upgrade' })
    await expect(checkoutButton).toBeVisible()
    await expect(checkoutButton).toBeEnabled()
    const puddleNavigations = []
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) puddleNavigations.push(frame.url())
    })
    await Promise.all([
      page.waitForURL((url) => url.hostname === 'checkout.stripe.com', { timeout: 30_000 }),
      checkoutButton.click()
    ])
    expect(new URL(page.url()).hostname).toBe('checkout.stripe.com')
    expect(puddleNavigations.some((url) => {
      try { return new URL(url).pathname === '/membership/checkout' } catch { return false }
    })).toBeFalsy()
  } finally {
    if (accountCreated) await deleteDisposableAccount(page)
  }
})
