import { test, expect } from '@playwright/test'
import { assertNoHorizontalOverflow } from './support.mjs'

const publicPages = [
  ['/', 'Puddle'],
  ['/signin', 'Jump back into your Puddle.'],
  ['/signup', 'Make plans that leave the chat.'],
  ['/privacy', 'Privacy Policy'],
  ['/terms', 'Terms of Service']
]

for (const [path, heading] of publicPages) {
  test(`${path} renders without horizontal overflow`, async ({ page }) => {
    const cspErrors = []
    page.on('console', (message) => {
      if (message.type() === 'error' && /content security policy/i.test(message.text())) cspErrors.push(message.text())
    })

    await page.goto(path)
    if (path === '/') {
      await expect(page.locator('body')).toContainText(heading)
    } else {
      await expect(page.getByRole('heading', { name: heading, level: 1 })).toBeVisible()
    }
    await assertNoHorizontalOverflow(page)
    if (path === '/privacy' || path === '/terms') expect(cspErrors).toEqual([])
  })
}

test('landing page links to signup, privacy, and terms', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('a[href="/signup"]:visible').first()).toBeVisible()
  await expect(page.locator('a[href="/privacy"]:visible').first()).toBeVisible()
  await expect(page.locator('a[href="/terms"]:visible').first()).toBeVisible()
})
