import { test, expect } from '@playwright/test'
import {
  admin,
  completeProfileDirect,
  createConfirmedUser,
  signInThroughUi
} from './support.mjs'

test('map pans on the compositor and visible catalogue markers open details', async ({ page }) => {
  test.setTimeout(60_000)
  let account
  try {
    account = await createConfirmedUser({ displayName: 'Map Interaction Tester' })
    await completeProfileDirect(account.user.id, { display_name: 'Map Interaction Tester' })
    await signInThroughUi(page, account.email, account.password, '/map?view=map')

    const map = page.getByTestId('feed-map-canvas')
    await expect(map).toBeVisible()
    const canvasBox = await map.boundingBox()
    expect(canvasBox).toBeTruthy()

    const markers = map.locator('.location-map-marker.is-catalogue')
    await expect.poll(() => markers.count(), { timeout: 30_000 }).toBeGreaterThan(0)
    let interactiveMarker = null
    for (let index = 0; index < await markers.count(); index += 1) {
      const candidate = markers.nth(index)
      const box = await candidate.boundingBox()
      if (!box || box.right <= canvasBox.x || box.left >= canvasBox.x + canvasBox.width || box.bottom <= canvasBox.y || box.top >= canvasBox.y + canvasBox.height) continue
      const hitTarget = await candidate.evaluate((element) => {
        const rect = element.getBoundingClientRect()
        const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
        return hit === element || hit?.closest?.('.location-map-marker') === element
      })
      if (hitTarget) {
        interactiveMarker = candidate
        break
      }
    }
    expect(interactiveMarker).toBeTruthy()
    await interactiveMarker.click()
    await expect(interactiveMarker).toHaveClass(/is-selected/)
    await expect(map.getByRole('link', { name: 'Open details', exact: true })).toBeVisible()

    const panLayer = map.locator('.location-map-pan-layer')
    await expect(panLayer).toHaveCount(1)
    const startX = canvasBox.x + canvasBox.width * .35
    const startY = canvasBox.y + canvasBox.height * .55
    await page.mouse.move(startX, startY)
    await page.mouse.down()
    await page.mouse.move(startX + 180, startY + 90, { steps: 8 })
    const dragTransform = await panLayer.evaluate((element) => element.style.transform)
    expect(dragTransform).toMatch(/^translate3d\((?!0, 0, 0\))/)
    await page.mouse.up()
    await expect.poll(() => panLayer.evaluate((element) => element.style.transform)).toMatch(/^translate3d\(0px, 0px, 0px\)$/)
  } finally {
    if (account?.user?.id) await admin.auth.admin.deleteUser(account.user.id)
  }
})
