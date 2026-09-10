import { randomUUID } from 'node:crypto'
import { test, expect } from '@playwright/test'
import { GLOBAL_LOCATION_FIXTURES } from './global-location-fixture.mjs'
import {
  admin,
  completeProfileDirect,
  createConfirmedUser,
  signInThroughApi,
  uniqueSuffix
} from './support.mjs'

const sharedFixture = GLOBAL_LOCATION_FIXTURES.find((place) => place.slug === 'moonlight-cafe')

async function searchForPerson(page, username) {
  const searchbox = page.getByRole('textbox', { name: 'Search friends by name or username' })
  await searchbox.fill(`@${username}`)
  await page.getByRole('button', { name: 'Search for friends' }).click()
  const result = page.locator('.figma-friends-search-results > div').filter({ hasText: username })
  await expect(result).toBeVisible()
  return result
}

test('two accounts can friend, share a place, and see one canonical share everywhere', async ({ page, browser }, testInfo) => {
  test.setTimeout(90_000)
  const owner = await createConfirmedUser({ displayName: 'Share Workflow Owner' })
  const peer = await createConfirmedUser({ displayName: 'Share Workflow Peer' })
  const ownerProfile = await completeProfileDirect(owner.user.id, {
    display_name: 'Share Workflow Owner',
    username: `share_owner_${uniqueSuffix(8)}`
  })
  const peerProfile = await completeProfileDirect(peer.user.id, {
    display_name: 'Share Workflow Peer',
    username: `share_peer_${uniqueSuffix(8)}`
  })
  const peerContext = await browser.newContext({ baseURL: testInfo.project.use.baseURL })
  const peerPage = await peerContext.newPage()

  try {
    const { error: referenceError } = await admin.from('location_refs').upsert({ id: sharedFixture.id, kind: 'global' })
    if (referenceError) throw referenceError
    const { error: savedStateError } = await admin.from('user_content_states').insert({
      profile_id: owner.user.id,
      location_id: sharedFixture.id,
      state: 'saved'
    })
    if (savedStateError) throw savedStateError

    await signInThroughApi(page, owner.email, owner.password, '/matches?tab=add')
    const ownerResult = await searchForPerson(page, peerProfile.username)
    await ownerResult.getByRole('button', { name: 'Add Share Workflow Peer', exact: true }).click()
    await expect(ownerResult.getByRole('button', { name: /Pending/ })).toBeVisible()

    await signInThroughApi(peerPage, peer.email, peer.password, '/matches?tab=add')
    const accept = peerPage.getByRole('button', { name: 'Accept friend request from Share Workflow Owner', exact: true })
    await expect(accept).toBeVisible()
    await accept.click()
    await expect.poll(async () => {
      const { data, error } = await admin.from('friendships')
        .select('state')
        .or(`and(requester_id.eq.${owner.user.id},addressee_id.eq.${peer.user.id}),and(requester_id.eq.${peer.user.id},addressee_id.eq.${owner.user.id})`)
        .limit(1)
      if (error) throw error
      return data?.[0]?.state || null
    }).toBe('accepted')

    await page.reload()
    const friendResult = await searchForPerson(page, peerProfile.username)
    await friendResult.getByRole('button', { name: 'Message', exact: true }).click()
    await expect(page).toHaveURL(/\/matches\?tab=messages&conversation=[0-9a-f-]+$/)
    const conversationId = new URL(page.url()).searchParams.get('conversation')
    expect(conversationId).toMatch(/^[0-9a-f-]{36}$/)

    const addPlace = page.locator('summary[aria-label="Add a place"]')
    await expect(addPlace).toBeVisible()
    await addPlace.click()
    const placeOption = page.locator('.figma-message-place-picker > button').filter({ hasText: 'Moonlight' })
    await expect(placeOption).toBeVisible()
    await placeOption.click()

    const locationLink = page.locator(`a.figma-friends-location-message[href="/plans/${sharedFixture.slug}"]`)
    await expect(locationLink).toBeVisible()
    await expect(locationLink).toContainText('Moonlight')

    const csrfResponse = await page.request.get('/api/security/csrf')
    expect(csrfResponse.ok()).toBeTruthy()
    const { token } = await csrfResponse.json()
    const retryKey = randomUUID()
    const requestBody = JSON.stringify({
      friendId: peer.user.id,
      locationId: sharedFixture.id,
      note: 'Idempotent share retry',
      shareKey: retryKey
    })
    const [firstRetry, secondRetry] = await Promise.all([
      page.request.post('/api/social/share-location', { headers: { 'content-type': 'application/json', 'x-puddle-csrf': token }, data: requestBody }),
      page.request.post('/api/social/share-location', { headers: { 'content-type': 'application/json', 'x-puddle-csrf': token }, data: requestBody })
    ])
    expect(firstRetry.status()).toBe(200)
    expect(secondRetry.status()).toBe(200)
    const firstResult = await firstRetry.json()
    const secondResult = await secondRetry.json()
    expect(secondResult).toEqual(firstResult)

    const { data: shareRows, error: shareRowsError } = await admin.from('content_shares').select('id').eq('share_key', retryKey)
    if (shareRowsError) throw shareRowsError
    expect(shareRows).toHaveLength(1)
    const { data: messageRows, error: messageRowsError } = await admin.from('messages').select('id').eq('share_key', retryKey)
    if (messageRowsError) throw messageRowsError
    expect(messageRows).toHaveLength(1)

    await peerPage.goto(`/matches?tab=messages&conversation=${conversationId}`)
    await expect(peerPage.locator(`a.figma-friends-location-message[href="/plans/${sharedFixture.slug}"]`).first()).toBeVisible()
    await peerPage.goto('/matches?tab=shared')
    await expect(peerPage.locator('.figma-friends-shared-place').filter({ hasText: 'Moonlight' }).first()).toBeVisible()
    await expect(peerPage.locator(`a[href="/plans/${sharedFixture.slug}"]`).first()).toBeVisible()

    await page.goto('/matches?tab=shared')
    await expect(page.locator('.figma-friends-shared-place').filter({ hasText: 'Moonlight' }).first()).toBeVisible()
  } finally {
    await peerContext.close()
    await admin.from('user_content_states').delete().eq('profile_id', owner.user.id).eq('location_id', sharedFixture.id)
    await Promise.all([
      admin.auth.admin.deleteUser(owner.user.id),
      admin.auth.admin.deleteUser(peer.user.id)
    ])
  }
})
