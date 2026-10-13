import { test, expect } from '@playwright/test'

const jamieId = '00000000-0000-4000-8000-000000000003'
const taylorId = '00000000-0000-4000-8000-000000000004'
const thread = id => `/matches?tab=messages&conversation=${id}`

test.beforeEach(async ({}, info) => {
  test.skip(!['phone', 'desktop'].includes(info.project.name), 'Request races are independent of additional viewport variants.')
})

async function selectThread(page, name) {
  if (await page.getByRole('link', { name: 'Back to conversations' }).isVisible()) {
    await page.getByRole('link', { name: 'Back to conversations' }).click()
  }
  await page.getByRole('button', { name: new RegExp(name) }).click()
}

test('late history cannot enter another conversation or restore its pagination', async ({ page }) => {
  let release
  const pending = new Promise(resolve => { release = resolve })
  let requested
  const started = new Promise(resolve => { requested = resolve })
  await page.route('**/api/fixture/messages?**', async route => {
    if (new URL(route.request().url()).searchParams.get('before')) {
      requested()
      await pending
      await route.fulfill({ json: { data: [{ id: 'stale-old-message', body: 'STALE JAMIE HISTORY', sender_id: 'old', created_at: '2026-10-01T00:00:00Z' }], error: null } })
    } else await route.continue()
  })
  await page.goto(thread(jamieId))
  await page.getByRole('button', { name: 'Load older messages' }).click()
  await started
  await selectThread(page, 'Taylor')
  await expect(page).toHaveURL(new RegExp(taylorId))
  await expect(page.locator('.figma-friends-messages')).toContainText('Taylor conversation')
  await expect(page.getByRole('button', { name: 'Load older messages' })).toHaveCount(0)
  const completed = page.waitForResponse(response => response.url().includes('/api/fixture/messages?') && new URL(response.url()).searchParams.get('before'))
  release()
  await completed
  await expect(page.locator('.figma-friends-messages')).not.toContainText('STALE JAMIE HISTORY')
  await expect(page.getByRole('button', { name: 'Load older messages' })).toHaveCount(0)
  await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toBeEnabled()
})

test('returning to the same ID rejects stale history without erasing its draft', async ({ page }) => {
  let release
  const pending = new Promise(resolve => { release = resolve })
  let requested
  const started = new Promise(resolve => { requested = resolve })
  await page.route('**/api/fixture/messages?**', async route => {
    if (new URL(route.request().url()).searchParams.get('before')) {
      requested()
      await pending
      await route.fulfill({ json: { data: [{ id: 'stale-return-message', body: 'STALE PREVIOUS VISIT', sender_id: 'old', created_at: '2026-10-01T00:00:00Z' }], error: null } })
    } else await route.continue()
  })
  await page.goto(thread(jamieId))
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Draft for Jamie')
  await page.getByRole('button', { name: 'Load older messages' }).click()
  await started
  await selectThread(page, 'Taylor')
  await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toHaveValue('')
  await selectThread(page, 'Jamie')
  await expect(page).toHaveURL(new RegExp(jamieId))
  const completed = page.waitForResponse(response => response.url().includes('/api/fixture/messages?') && new URL(response.url()).searchParams.get('before'))
  release()
  await completed
  await expect(page.locator('.figma-friends-messages')).not.toContainText('STALE PREVIOUS VISIT')
  await expect(page.getByRole('button', { name: 'Load older messages' })).toBeEnabled()
  await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toHaveValue('Draft for Jamie')
})
