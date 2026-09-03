import { test, expect } from '@playwright/test'
import {
  admin,
  completeProfileDirect,
  createConfirmedUser,
  createDirectConversationFixture,
  deleteDirectConversationFixture,
  signInThroughApi
} from './support.mjs'

test('mobile Messages keeps selection and conversation states inside the viewport', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-chromium', 'Mobile Messages contract only')

  const owner = await createConfirmedUser({ displayName: 'Mobile Messages Owner' })
  const peer = await createConfirmedUser({ displayName: 'Mobile Messages Peer' })
  let conversationId = null

  try {
    await completeProfileDirect(owner.user.id, { display_name: 'Mobile Messages Owner' })
    await completeProfileDirect(peer.user.id, { display_name: 'Mobile Messages Peer' })
    conversationId = await createDirectConversationFixture(owner.user.id, peer.user.id)

    await signInThroughApi(page, owner.email, owner.password, '/matches?tab=messages')
    const screen = page.locator('.figma-friends-screen.is-messages')
    const tabs = page.locator('.figma-friends-tabs')
    const chat = page.locator('.figma-friends-chat')
    const mobileNav = page.locator('.figma-dashboard-mobile-nav')

    await expect(screen).toBeVisible()
    await expect(tabs).toBeVisible()
    await expect(chat).toBeHidden()
    await expect(mobileNav).toBeVisible()

    const selectionGeometry = await page.evaluate(() => ({
      documentHeight: document.documentElement.scrollHeight,
      viewportHeight: document.documentElement.clientHeight,
      screenBottom: document.querySelector('.figma-friends-screen')?.getBoundingClientRect().bottom,
      navTop: document.querySelector('.figma-dashboard-mobile-nav')?.getBoundingClientRect().top
    }))
    expect(selectionGeometry.documentHeight).toBeLessThanOrEqual(selectionGeometry.viewportHeight + 1)
    expect(selectionGeometry.screenBottom).toBeLessThanOrEqual(selectionGeometry.navTop + 1)

    await page.locator('.figma-friends-conversations > button').filter({ hasText: 'Mobile Messages Peer' }).click()
    await expect(page).toHaveURL(new RegExp(`/matches\\?tab=messages&conversation=${conversationId}$`))
    await expect(chat).toBeVisible()
    await expect(tabs).toBeHidden()
    await expect(mobileNav).toBeVisible()
    await expect(page.getByRole('textbox', { name: 'Message' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Back to conversations' })).toBeVisible()

    const conversationGeometry = await page.evaluate(() => {
      const screenBox = document.querySelector('.figma-friends-screen')?.getBoundingClientRect()
      const navBox = document.querySelector('.figma-dashboard-mobile-nav')?.getBoundingClientRect()
      const composerBox = document.querySelector('.figma-friends-composer')?.getBoundingClientRect()
      return {
        documentHeight: document.documentElement.scrollHeight,
        viewportHeight: document.documentElement.clientHeight,
        screenBottom: screenBox?.bottom,
        navTop: navBox?.top,
        composerBottom: composerBox?.bottom
      }
    })
    expect(conversationGeometry.documentHeight).toBeLessThanOrEqual(conversationGeometry.viewportHeight + 1)
    expect(conversationGeometry.screenBottom).toBeLessThanOrEqual(conversationGeometry.navTop + 1)
    expect(conversationGeometry.composerBottom).toBeLessThanOrEqual(conversationGeometry.navTop + 1)

    await page.getByRole('link', { name: 'Back to conversations' }).click()
    await expect(page).toHaveURL(/\/matches\?tab=messages$/)
    await expect(chat).toBeHidden()
    await expect(tabs).toBeVisible()
    await expect(page.locator('[aria-label="Loading conversation"]')).toHaveCount(0)
  } finally {
    if (conversationId) await deleteDirectConversationFixture(conversationId, owner.user.id, peer.user.id)
    await Promise.all([
      admin.auth.admin.deleteUser(owner.user.id),
      admin.auth.admin.deleteUser(peer.user.id)
    ])
  }
})
