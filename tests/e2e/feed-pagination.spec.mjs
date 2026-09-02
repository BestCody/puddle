import { test, expect } from '@playwright/test'
import {
  admin,
  completeProfileDirect,
  createConfirmedUser,
  signInThroughUi
} from './support.mjs'

function feedPost(id, title) {
  return {
    id,
    title,
    body: `Body for ${title}`,
    created_at: '2026-08-29T16:00:00.000Z',
    author: { display_name: 'Feed Pagination Tester', username: 'feed-pagination' },
    author_avatar_url: null,
    comments: [],
    saved: false,
    location_id: `location-${id}`,
    location: {
      slug: `place-${id}`,
      name: title,
      kind: 'park',
      neighborhood: 'Toronto',
      city: 'Toronto'
    },
    photo_urls: []
  }
}

test('More puddles appends the next cursor page without navigating away from the feed', async ({ page }) => {
  const account = await createConfirmedUser({ displayName: 'Feed Pagination Tester' })
  try {
    await completeProfileDirect(account.user.id, { display_name: 'Feed Pagination Tester' })
    await signInThroughUi(page, account.email, account.password)

    const requests = []
    await page.route('**/api/social-feed*', async (route) => {
      const url = new URL(route.request().url())
      const isNextPage = url.searchParams.has('before') && url.searchParams.has('beforeId')
      requests.push({ isNextPage, beforeId: url.searchParams.get('beforeId') })
      const payload = isNextPage
        ? {
            items: [feedPost('post-3', 'Third Puddle')],
            pagination: { hasMore: false, nextBeforeCreatedAt: null, nextBeforePostId: null },
            self: { display_name: 'Feed Pagination Tester', avatar_url: null }
          }
        : {
            items: [feedPost('post-1', 'First Puddle'), feedPost('post-2', 'Second Puddle')],
            pagination: {
              hasMore: true,
              nextBeforeCreatedAt: '2026-08-28T16:00:00.000Z',
              nextBeforePostId: 'post-2'
            },
            self: { display_name: 'Feed Pagination Tester', avatar_url: null }
          }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload) })
    })

    await page.goto('/map')
    await expect(page.locator('[data-testid="feed-post"]')).toHaveCount(2)
    await expect(page.getByRole('button', { name: 'More puddles', exact: true })).toBeVisible()

    const feedUrl = page.url()
    await page.getByRole('button', { name: 'More puddles', exact: true }).click()

    await expect(page.locator('[data-testid="feed-post"]')).toHaveCount(3)
    await expect(page.getByRole('heading', { name: 'First Puddle', exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Third Puddle', exact: true })).toBeVisible()
    expect(page.url()).toBe(feedUrl)
    expect(requests).toEqual([
      { isNextPage: false, beforeId: null },
      { isNextPage: true, beforeId: 'post-2' }
    ])
  } finally {
    await admin.auth.admin.deleteUser(account.user.id)
  }
})
