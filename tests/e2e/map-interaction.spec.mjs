import { test, expect } from '@playwright/test'
import {
  admin,
  completeProfileDirect,
  createConfirmedUser,
  signInThroughUi
} from './support.mjs'

test('map clusters are clickable, pans on the compositor, and markers show directions', async ({ page }) => {
  test.setTimeout(60_000)
  let account
  try {
    account = await createConfirmedUser({ displayName: 'Map Interaction Tester' })
    await completeProfileDirect(account.user.id, { display_name: 'Map Interaction Tester' })
    await signInThroughUi(page, account.email, account.password, '/map?view=map')

    const map = page.getByTestId('feed-map-canvas')
    await expect(map).toBeVisible()
    const mapCanvas = map.locator('.location-map-canvas')
    await expect(mapCanvas).toBeVisible()
    const canvasBox = await map.boundingBox()
    expect(canvasBox).toBeTruthy()

    const catalogueMarkers = map.locator('.location-map-marker.is-catalogue')
    await expect.poll(() => catalogueMarkers.count(), { timeout: 30_000 }).toBeGreaterThan(1)
    const zoomOut = map.getByRole('button', { name: 'Zoom out', exact: true })
    await zoomOut.click()
    await zoomOut.click()
    await expect(mapCanvas).toHaveAttribute('data-map-zoom', '12')

    const clusters = map.locator('.location-map-cluster')
    await expect.poll(() => clusters.count(), { timeout: 30_000 }).toBeGreaterThan(0)
    let interactiveCluster = null
    for (let index = 0; index < await clusters.count(); index += 1) {
      const candidate = clusters.nth(index)
      const box = await candidate.boundingBox()
      if (!box || box.right <= canvasBox.x || box.left >= canvasBox.x + canvasBox.width || box.bottom <= canvasBox.y || box.top >= canvasBox.y + canvasBox.height) continue
      const hitTarget = await candidate.evaluate((element) => {
        const rect = element.getBoundingClientRect()
        const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
        return hit === element || hit?.closest?.('.location-map-cluster') === element
      })
      if (hitTarget) {
        interactiveCluster = candidate
        break
      }
    }
    expect(interactiveCluster).toBeTruthy()
    const beforeClusterZoom = await mapCanvas.getAttribute('data-map-zoom')
    await interactiveCluster.click()
    await expect.poll(() => mapCanvas.getAttribute('data-map-zoom')).not.toBe(beforeClusterZoom)

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
    const panLayer = map.locator('.location-map-pan-layer')
    await expect(panLayer).toHaveCount(1)
    const markerBox = await interactiveMarker.boundingBox()
    expect(markerBox).toBeTruthy()
    await page.mouse.move(markerBox.x + markerBox.width / 2, markerBox.y + markerBox.height / 2)
    await page.mouse.down()
    await page.mouse.move(markerBox.x + markerBox.width / 2 + 90, markerBox.y + markerBox.height / 2 + 35, { steps: 6 })
    const markerDragTransform = await panLayer.evaluate((element) => element.style.transform)
    expect(markerDragTransform).toMatch(/^translate3d\((?!0, 0, 0\))/)
    await page.mouse.up()
    await expect.poll(() => panLayer.evaluate((element) => element.style.transform)).toMatch(/^translate3d\(0px, 0px, 0px\)$/)
    await interactiveMarker.click()
    await expect(interactiveMarker).toHaveClass(/is-selected/)
    await expect(map.getByRole('link', { name: 'Directions', exact: true })).toBeVisible()
    await expect(map.getByRole('link', { name: 'Open details', exact: true })).toHaveCount(0)

    const beforeScroll = await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY }))
    const beforeZoom = await mapCanvas.getAttribute('data-map-zoom')
    const wheelBox = await mapCanvas.boundingBox()
    expect(wheelBox).toBeTruthy()
    await page.mouse.move(wheelBox.x + wheelBox.width * .25, wheelBox.y + wheelBox.height * .5)
    await page.mouse.wheel(0, 500)
    await expect.poll(() => mapCanvas.getAttribute('data-map-zoom')).not.toBe(beforeZoom)
    expect(await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY }))).toEqual(beforeScroll)

    const ctrlWheel = await mapCanvas.evaluate((element) => {
      const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, ctrlKey: true, deltaY: 100 })
      element.dispatchEvent(event)
      return event.defaultPrevented
    })
    expect(ctrlWheel).toBe(true)

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
