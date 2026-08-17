import { test, expect } from '@playwright/test'
import { admin, completeProfileDirect, createConfirmedUser, signInThroughUi } from './support.mjs'

const seedSlugs = ['moonlight-cafe', 'sunset-steps', 'laneway-gallery', 'harbour-activity-deck']

test('reviews, request cancellation, category overflow, and catalogue map search work end to end', async ({ page }) => {
  test.setTimeout(90_000)
  const owner = await createConfirmedUser({ displayName: 'Completed UI Owner' })
  const friend = await createConfirmedUser({ displayName: 'Completed UI Friend' })

  try {
    await completeProfileDirect(owner.user.id, { display_name: 'Completed UI Owner' })
    await completeProfileDirect(friend.user.id, { display_name: 'Completed UI Friend' })

    const { data: locations, error: locationError } = await admin
      .from('locations')
      .select('id,slug,name,kind')
      .in('slug', seedSlugs)
    if (locationError) throw locationError
    expect(locations).toHaveLength(seedSlugs.length)

    const locationBySlug = new Map(locations.map((location) => [location.slug, location]))
    const { error: saveError } = await admin.from('user_content_states').insert(
      seedSlugs.map((slug) => ({
        profile_id: owner.user.id,
        location_id: locationBySlug.get(slug).id,
        state: 'saved'
      }))
    )
    if (saveError) throw saveError

    const { error: requestError } = await admin.from('friendships').upsert({
      requester_id: owner.user.id,
      addressee_id: friend.user.id,
      state: 'pending',
      created_at: new Date().toISOString()
    }, { onConflict: 'requester_id,addressee_id' })
    if (requestError) throw requestError

    await signInThroughUi(page, owner.email, owner.password, '/plans/moonlight-cafe')

    // The detail-page + must expose real overflow categories instead of navigating back to All.
    const moreCategories = page.getByLabel('More saved categories')
    await expect(moreCategories).toBeVisible()
    await moreCategories.click()
    const overflow = moreCategories.locator('..')
    await expect(overflow.getByRole('link')).toHaveCount(2)

    // Review CRUD must persist through the real server actions and RPCs.
    await page.getByLabel('Your rating').selectOption('5')
    await page.getByLabel('Review').fill('Excellent espresso and a useful E2E review.')
    await page.getByRole('button', { name: 'Post review' }).click()
    await expect(page.getByText('Excellent espresso and a useful E2E review.', { exact: true })).toBeVisible()

    await page.getByLabel('Your rating').selectOption('4')
    await page.getByLabel('Review').fill('Updated E2E review body.')
    await page.getByRole('button', { name: 'Update review' }).click()
    await expect(page.getByText('Updated E2E review body.', { exact: true })).toBeVisible()
    await expect(page.getByText('Excellent espresso and a useful E2E review.', { exact: true })).toHaveCount(0)

    await page.getByRole('button', { name: 'Delete my review' }).click()
    await expect(page.getByText('No reviews yet. Be the first to review this place.')).toBeVisible()

    // An outgoing pending friend request must be cancellable from the Add tab.
    await page.goto('/matches?tab=add')
    const cancelRequest = page.getByRole('button', { name: 'Cancel friend request to Completed UI Friend' })
    await expect(cancelRequest).toBeVisible()
    await cancelRequest.click()
    await expect(cancelRequest).toHaveCount(0)
    await expect(page.getByText('No sent requests')).toBeVisible()

    const { data: friendship } = await admin
      .from('friendships')
      .select('state')
      .eq('requester_id', owner.user.id)
      .eq('addressee_id', friend.user.id)
      .single()
    expect(friendship.state).toBe('removed')

    // Map search must return catalogue locations even when they are not personal map state.
    await admin.from('user_content_states')
      .delete()
      .eq('profile_id', owner.user.id)
      .eq('location_id', locationBySlug.get('moonlight-cafe').id)
      .eq('state', 'saved')

    await page.goto('/map?view=map&q=Moonlight')
    await expect(page.getByLabel('Search all Puddle locations')).toHaveValue('Moonlight')
    await expect(page.getByTestId('feed-map-canvas').getByText('Moonlight Café', { exact: true }).first()).toBeVisible()
    await expect(page.getByTestId('feed-map-canvas').getByText('Puddle', { exact: true }).first()).toBeVisible()
  } finally {
    await admin.from('location_reviews').delete().eq('author_id', owner.user.id).catch(() => {})
    await admin.from('friendships').delete().or(`requester_id.eq.${owner.user.id},addressee_id.eq.${owner.user.id}`).catch(() => {})
    await admin.from('friendships').delete().or(`requester_id.eq.${friend.user.id},addressee_id.eq.${friend.user.id}`).catch(() => {})
    await admin.from('user_content_states').delete().eq('profile_id', owner.user.id).catch(() => {})
    await admin.auth.admin.deleteUser(owner.user.id).catch(() => {})
    await admin.auth.admin.deleteUser(friend.user.id).catch(() => {})
  }
})
