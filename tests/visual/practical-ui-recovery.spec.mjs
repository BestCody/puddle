import { test, expect } from '@playwright/test'
import { MAX_SEARCH_DISTANCE_KM, parseDiscoveryFilters } from '../../lib/app/discovery-filters.js'

test.beforeEach(async ({ context }, info) => {
  test.skip(!['small-phone', 'phone', 'desktop'].includes(info.project.name), 'Exercise the distinct mobile and desktop flows; existing suites cover the remaining layouts')
  await context.route('**/*', route => ['localhost', '127.0.0.1'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort())
})

test('composer closes with one click while its saved-place picker is open', async ({ page }) => {
  await page.goto('/map')
  await page.getByRole('button', { name: 'Create a puddle...', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Create a puddle', exact: true })
  await dialog.locator('summary').click()
  await expect(dialog.getByRole('searchbox', { name: 'Search saved places' })).toBeVisible()
  await dialog.getByRole('button', { name: 'Close create puddle' }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByRole('button', { name: 'Create a puddle...', exact: true })).toBeVisible()
})

test('pill highlight follows the active column during viewport changes', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'This test itself crosses all relevant sizes')
  await page.goto('/create/post')
  const pill = page.getByRole('navigation', { name: 'Feed or map' })
  for (const viewport of [{ width: 1440, height: 900 }, { width: 320, height: 568 }, { width: 844, height: 393 }, { width: 1440, height: 900 }]) {
    await page.setViewportSize(viewport)
    await expect.poll(() => pill.evaluate(node => {
      const style = getComputedStyle(node), highlight = getComputedStyle(node, '::before')
      const active = node.querySelector('[aria-current="page"]').getBoundingClientRect()
      const left = node.getBoundingClientRect().left + parseFloat(style.borderLeftWidth) + parseFloat(highlight.left)
      return Math.max(Math.abs(left - active.left), Math.abs(parseFloat(highlight.width) - active.width))
    })).toBeLessThan(2)
  }
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

test('Settings, Swipe detail actions and outgoing messages have readable text', async ({ page }) => {
  const mobile = page.viewportSize().width <= 760
  await page.goto(`/account?section=appearance${mobile ? '&mobile=1' : ''}`)
  const save = page.getByRole('button', { name: 'Save appearance', exact: true })
  await expect(save).toBeVisible()
  expect(await contrast(save)).toBeGreaterThanOrEqual(4.5)
  await page.goto('/discover')
  await page.locator('.figma-swipe-card:not(.is-preview)').press('Enter')
  const dialog = page.getByRole('dialog', { name: 'Full details for Maple Grove Park', exact: true })
  for (const name of ['Pass', 'Save', 'Star']) expect(await contrast(dialog.getByRole('button', { name, exact: true }))).toBeGreaterThanOrEqual(4.5)
  await page.goto('/matches?tab=messages&conversation=00000000-0000-4000-8000-000000000003')
  const outgoing = page.locator('.figma-friends-message.is-mine > div').first()
  await expect(outgoing).toBeVisible()
  expect(await contrast(outgoing)).toBeGreaterThanOrEqual(4.5)
})

test('every offered Swipe distance is supported by the actual filter parser', async ({ page }) => {
  await page.goto('/discover')
  await page.getByRole('button', { name: 'Open filters' }).click()
  const distance = page.getByRole('combobox', { name: 'Distance', exact: true })
  const values = await distance.locator('option').evaluateAll(options => options.map(option => Number(option.value)))
  expect(Math.max(...values)).toBe(MAX_SEARCH_DISTANCE_KM)
  for (const value of values) expect(parseDiscoveryFilters({ distance: value }).distance).toBe(value)
})

test('Feed saves and comment retries retain the query, appended posts and reading position', async ({ page }) => {
  await page.route('**/api/social-feed*', async route => {
    const response = await route.fetch(), payload = await response.json()
    const more = new URL(route.request().url()).searchParams.has('before')
    const posts = payload.items.map((post, index, all) => index === 2 ? { ...post, location_id: all[0].location_id, location: all[0].location } : post)
    await route.fulfill({ json: { ...payload, items: more ? posts.slice(2) : posts.slice(0, 2), pagination: { hasMore: !more, nextBeforeCreatedAt: posts[1].created_at, nextBeforePostId: posts[1].id } } })
  })
  await page.goto('/map?q=park')
  await page.getByRole('button', { name: 'More puddles', exact: true }).click()
  const posts = page.getByTestId('feed-post')
  await expect(posts).toHaveCount(3)
  const post = posts.nth(2), save = post.getByRole('button', { name: 'Save Maple Grove Park', exact: true })
  await save.scrollIntoViewIfNeeded()
  const position = await page.evaluate(() => window.scrollY)
  await save.click()
  await expect(post.getByRole('button', { name: 'Remove Maple Grove Park from Saved' })).toBeVisible()
  await expect(posts.nth(0).getByRole('button', { name: 'Remove Maple Grove Park from Saved' })).toHaveCount(1)
  expect(Math.abs(await page.evaluate(() => window.scrollY) - position)).toBeLessThan(2)
  await post.locator('summary').first().click()
  const comment = post.getByRole('textbox', { name: 'Add a comment', exact: true })
  await comment.fill('Retry this comment')
  await post.getByRole('button', { name: 'Post', exact: true }).click()
  await expect(post.getByRole('alert')).toContainText('could not add')
  await expect(comment).toHaveValue('Retry this comment')
  await expect(page).toHaveURL(/\/map\?q=park$/)
  await expect(posts).toHaveCount(3)
  await comment.fill('A successful comment')
  await post.getByRole('button', { name: 'Post', exact: true }).click()
  await expect(post.getByText('A successful comment', { exact: true })).toBeVisible()
  await expect(comment).toHaveValue('')
  await expect(page).toHaveURL(/\/map\?q=park$/)
  await expect(posts).toHaveCount(3)
})

test('reset and change-email failures retain the input and current form on retry', async ({ page }) => {
  for (const [route, label, button] of [
    ['/forgot-password', 'Email', 'Send reset link'],
    ['/change-email?settings_return=%2Faccount%3Fmobile%3D1%26section%3Dsecurity', 'New email address', 'Send confirmation emails']
  ]) {
    await page.goto(route)
    const email = page.getByRole('textbox', { name: label, exact: true })
    await email.fill('kept@example.test')
    const form = page.locator('form').filter({ has: email })
    for (let attempt = 0; attempt < 2; attempt++) {
      await form.getByRole('button', { name: new RegExp(button) }).click()
      await expect(form.getByRole('alert')).toContainText(/unavailable|could not/i)
      await expect(email).toHaveValue('kept@example.test')
      expect(new URL(page.url()).pathname).toBe(route.split('?')[0])
      expect(page.url()).not.toContain('kept')
    }
  }
})
