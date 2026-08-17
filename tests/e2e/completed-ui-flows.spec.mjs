import { test, expect } from '@playwright/test'
import { admin, completeProfileDirect, createConfirmedUser, signInThroughUi } from './support.mjs'

const seedSlugs = ['moonlight-cafe', 'sunset-steps', 'laneway-gallery', 'harbour-activity-deck']
const detailPath = '/plans/moonlight-cafe'

async function bestEffort(operation) {
  try { await operation } catch {}
}

async function submitServerAction(page, buttonName, expectedMessage) {
  await Promise.all([
    page.waitForURL((url) => url.searchParams.get('success') === expectedMessage, { timeout: 30_000 }),
    page.getByRole('button', { name: buttonName }).click()
  ])
  await page.goto(detailPath)
}

test('reviews, request cancellation, category overflow, and viewport map loading work end to end', async ({ page }) => {
  test.setTimeout(120_000)
  const owner = await createConfirmedUser({ displayName: 'Completed UI Owner' })
  const friend = await createConfirmedUser({ displayName: 'Completed UI Friend' })

  try {
    await completeProfileDirect(owner.user.id, { display_name: 'Completed UI Owner' })
    await completeProfileDirect(friend.user.id, { display_name: 'Completed UI Friend' })

    const { data: locations, error: locationError } = await admin
      .from('locations')
      .select('id,slug,name,kind,summary,neighborhood,city,latitude,longitude')
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

    await signInThroughUi(page, owner.email, owner.password, detailPath)

    const moreCategories = page.getByLabel('More saved categories')
    await expect(moreCategories).toBeVisible()
    await moreCategories.click()
    await expect(moreCategories.locator('..').getByRole('link')).toHaveCount(2)

    await page.getByLabel('Your rating').selectOption('5')
    await page.getByLabel('Review').fill('Excellent espresso and a useful E2E review.')
    await submitServerAction(page, 'Post review', 'Your review was saved.')

    let reviewSection = page.getByTestId('saved-place-reviews')
    let ownReviewCard = reviewSection.locator('article').filter({ hasText: 'Completed UI Owner' })
    await expect(ownReviewCard.getByText('Excellent espresso and a useful E2E review.', { exact: true })).toBeVisible()

    await page.getByLabel('Your rating').selectOption('4')
    await page.getByLabel('Review').fill('Updated E2E review body.')
    await submitServerAction(page, 'Update review', 'Your review was saved.')

    reviewSection = page.getByTestId('saved-place-reviews')
    ownReviewCard = reviewSection.locator('article').filter({ hasText: 'Completed UI Owner' })
    await expect(ownReviewCard.getByText('Updated E2E review body.', { exact: true })).toBeVisible()
    await expect(ownReviewCard.getByText('Excellent espresso and a useful E2E review.', { exact: true })).toHaveCount(0)
    await expect(ownReviewCard.getByLabel('4 out of 5 stars')).toBeVisible()

    await submitServerAction(page, 'Delete my review', 'Your review was removed.')
    reviewSection = page.getByTestId('saved-place-reviews')
    ownReviewCard = reviewSection.locator('article').filter({ hasText: 'Completed UI Owner' })
    await expect(ownReviewCard).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Post review' })).toBeVisible()

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

    await admin.from('user_content_states')
      .delete()
      .eq('profile_id', owner.user.id)
      .eq('location_id', locationBySlug.get('moonlight-cafe').id)
      .eq('state', 'saved')

    const moonlight = locationBySlug.get('moonlight-cafe')
    await page.route('**/api/map/viewport?**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          points: [{
            id: moonlight.id,
            location_id: moonlight.id,
            title: moonlight.name,
            summary: moonlight.summary || 'Moonlight Café',
            category: moonlight.kind,
            neighborhood: moonlight.neighborhood,
            city: moonlight.city,
            latitude: Number(moonlight.latitude),
            longitude: Number(moonlight.longitude),
            href: `/plans/${moonlight.slug}`,
            photo_url: null,
            states: ['catalogue'],
            match: null,
            plan: null
          }],
          tookMs: 1,
          timedOut: false,
          limit: 150
        })
      })
    })

    await page.goto('/map?view=map')
    const map = page.getByTestId('feed-map-canvas')
    const catalogueMarker = map.getByRole('button', { name: `${moonlight.name}, Puddle` })
    await expect(catalogueMarker).toBeVisible()
    await catalogueMarker.click()
    await expect(map.getByRole('heading', { name: moonlight.name })).toBeVisible()
    await expect(map.getByRole('link', { name: 'Open details' })).toHaveAttribute('href', `/plans/${moonlight.slug}`)
    await expect(map.locator('.location-map-marker.is-catalogue')).toHaveCount(1)
  } finally {
    await bestEffort(admin.from('location_reviews').delete().eq('author_id', owner.user.id))
    await bestEffort(admin.from('friendships').delete().or(`requester_id.eq.${owner.user.id},addressee_id.eq.${owner.user.id}`))
    await bestEffort(admin.from('friendships').delete().or(`requester_id.eq.${friend.user.id},addressee_id.eq.${friend.user.id}`))
    await bestEffort(admin.from('user_content_states').delete().eq('profile_id', owner.user.id))
    await bestEffort(admin.auth.admin.deleteUser(owner.user.id))
    await bestEffort(admin.auth.admin.deleteUser(friend.user.id))
  }
})
