import { test, expect } from '@playwright/test'
import { admin, completeProfileDirect, createConfirmedUser, signInThroughUi } from './support.mjs'
import { globalLocationFixtureBySlug } from './global-location-fixture.mjs'

async function bestEffort(operation) {
  try { await operation } catch {}
}

test('saved state and social content hydrate canonical location metadata from OpenSearch', async ({ page }) => {
  const account = await createConfirmedUser({ displayName: 'Global Overlay E2E' })
  const savedPlace = globalLocationFixtureBySlug('moonlight-cafe')
  const socialPlace = globalLocationFixtureBySlug('figma-maple-grove-park')

  try {
    await completeProfileDirect(account.user.id, {
      display_name: 'Global Overlay E2E',
      interests: ['cafe', 'park', 'gallery'],
      search_radius_km: 25
    })

    const { error: refError } = await admin.from('location_refs').upsert([
      { id: savedPlace.id, kind: 'global' },
      { id: socialPlace.id, kind: 'global' }
    ], { onConflict: 'id', ignoreDuplicates: true })
    if (refError) throw refError

    const { error: savedError } = await admin.from('user_content_states').insert({
      profile_id: account.user.id,
      location_id: savedPlace.id,
      state: 'saved'
    })
    if (savedError) throw savedError

    const { error: postError } = await admin.from('social_posts').insert({
      author_id: account.user.id,
      location_id: socialPlace.id,
      title: socialPlace.name,
      body: 'OpenSearch-backed E2E social post.',
      visibility: 'public'
    })
    if (postError) throw postError

    await signInThroughUi(page, account.email, account.password, '/plans')
    await expect(page).toHaveURL(/\/plans$/)
    await expect(page.getByTestId('saved-card').first()).toBeVisible()
    await expect(page.getByTestId('saved-card').first()).toContainText(savedPlace.name)

    await page.goto(`/plans/${savedPlace.slug}`)
    await expect(page.getByTestId('saved-detail-screen')).toBeVisible()
    await expect(page.getByTestId('saved-detail-card')).toContainText(savedPlace.name)

    await page.goto('/map')
    await expect(page.getByTestId('feed-screen')).toHaveAttribute('data-view', 'feed')
    await expect(page.getByTestId('feed-post').first()).toBeVisible()
    await expect(page.getByTestId('feed-post').first()).toContainText(socialPlace.name)

    await page.goto('/map?view=map')
    await expect(page.getByTestId('feed-map-canvas')).toBeVisible()
    await expect(page.locator('.location-map-marker').first()).toBeVisible()
  } finally {
    await bestEffort(admin.from('social_posts').delete().eq('author_id', account.user.id))
    await bestEffort(admin.from('user_content_states').delete().eq('profile_id', account.user.id))
    await bestEffort(admin.auth.admin.deleteUser(account.user.id))
  }
})
