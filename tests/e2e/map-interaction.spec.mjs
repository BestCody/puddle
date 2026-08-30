import { test, expect } from '@playwright/test'
import {
  admin,
  completeProfileDirect,
  createConfirmedUser,
  signInThroughUi
} from './support.mjs'

test('map markers are individually clickable, pan on the compositor, and show directions', async ({ page }) => {
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

    await expect(map.locator('.location-map-cluster')).toHaveCount(0)

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
    const markerLabel = await interactiveMarker.getAttribute('aria-label')
    expect(markerLabel).toBeTruthy()
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
    const markerAfterDrag = map.getByRole('button', { name: markerLabel, exact: true })
    await markerAfterDrag.click()
    await expect(markerAfterDrag).toHaveClass(/is-selected/)
    await expect(map.getByRole('link', { name: 'Directions', exact: true })).toBeVisible()
    await expect(map.getByRole('link', { name: 'Open details', exact: true })).toHaveCount(0)
    const selectionPanel = map.locator('.location-map-pan-layer > .location-map-side')
    await expect(selectionPanel).toBeVisible()
    const selectionBeforeDrag = await selectionPanel.boundingBox()
    expect(selectionBeforeDrag).toBeTruthy()
    const dragOrigin = await mapCanvas.evaluate((element) => {
      const rect = element.getBoundingClientRect()
      const candidates = [[.08, .18], [.92, .18], [.08, .82], [.92, .82], [.5, .9]]
      for (const [x, y] of candidates) {
        const point = document.elementFromPoint(rect.left + rect.width * x, rect.top + rect.height * y)
        if (!point?.closest?.('button,a')) return { x: rect.left + rect.width * x, y: rect.top + rect.height * y }
      }
      return { x: rect.left + rect.width * .08, y: rect.top + rect.height * .18 }
    })
    await page.mouse.move(dragOrigin.x, dragOrigin.y)
    await page.mouse.down()
    await page.mouse.move(dragOrigin.x + 90, dragOrigin.y + 35, { steps: 6 })
    await expect.poll(async () => {
      const box = await selectionPanel.boundingBox()
      return box ? Math.round(box.x) : null
    }).not.toBe(Math.round(selectionBeforeDrag.x))
    await page.mouse.up()

    await mapCanvas.focus()
    const beforeKeyboardPan = await mapCanvas.getAttribute('data-map-center-longitude')
    const beforeKeyboardZoom = await mapCanvas.getAttribute('data-map-zoom')
    const beforeKeyboardScroll = await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY }))
    await page.keyboard.press('ArrowRight')
    await expect.poll(() => mapCanvas.getAttribute('data-map-center-longitude')).not.toBe(beforeKeyboardPan)
    await page.keyboard.press('+')
    await expect.poll(() => mapCanvas.getAttribute('data-map-zoom')).not.toBe(beforeKeyboardZoom)
    expect(await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY }))).toEqual(beforeKeyboardScroll)

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
