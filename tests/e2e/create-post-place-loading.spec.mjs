import { test, expect } from '@playwright/test'
import { GLOBAL_LOCATION_FIXTURES } from './global-location-fixture.mjs'
import { admin, completeProfileDirect, createConfirmedUser, signInThroughApi } from './support.mjs'

test('a Swipe-selected post loads saved place options only when the chooser opens', async ({ page }) => {
  const selected = GLOBAL_LOCATION_FIXTURES.find((place) => place.slug === 'moonlight-cafe')
  const saved = GLOBAL_LOCATION_FIXTURES.find((place) => place.slug === 'sunset-steps')
  const account = await createConfirmedUser({ displayName: 'Create Post Loading Tester' })
  const snapshotRequests = []
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/map/snapshot') snapshotRequests.push(request)
  })

  try {
    await completeProfileDirect(account.user.id, { display_name: 'Create Post Loading Tester' })
    const { error: referenceError } = await admin.from('location_refs').upsert({ id: saved.id, kind: 'global' })
    if (referenceError) throw referenceError
    const { error: indexError } = await admin.from('location_ref_search_index').upsert({
      location_id: saved.id,
      name: saved.name,
      slug: saved.slug,
      category: saved.category,
      city: saved.city
    })
    if (indexError) throw indexError
    const { error: savedError } = await admin.from('user_content_states').insert({
      profile_id: account.user.id,
      location_id: saved.id,
      state: 'saved'
    })
    if (savedError) throw savedError

    await signInThroughApi(page, account.email, account.password, `/create/post?location=${selected.id}`)
    await expect(page.getByRole('form', { name: 'Create a puddle post' })).toBeVisible()
    await expect(page.locator('input[name="location_id"]')).toHaveValue(selected.id)
    expect(snapshotRequests).toHaveLength(0)

    const responsePromise = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/map/snapshot')
    await page.getByLabel('Open add menu').click()
    const response = await responsePromise
    expect(response.ok()).toBeTruthy()
    expect((await response.json()).points.some((point) => point.id === saved.id)).toBe(true)
    await expect(page.locator(`.figma-create-post-location-options a[href="/create/post?location=${saved.id}"]`)).toBeVisible()
    expect(snapshotRequests).toHaveLength(1)

    await page.locator(`.figma-create-post-location-options a[href="/create/post?location=${saved.id}"]`).click()
    await expect(page.locator('input[name="location_id"]')).toHaveValue(saved.id)
  } finally {
    await admin.from('user_content_states').delete().eq('profile_id', account.user.id).eq('location_id', saved.id)
    await admin.auth.admin.deleteUser(account.user.id)
  }
})
