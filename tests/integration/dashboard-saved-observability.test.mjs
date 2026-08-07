import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8')

test('dashboard sidebar is resizable, persistent, and keyboard accessible', async () => {
  const [shell, sidebar, styles] = await Promise.all([
    read('components/product-shell.js'),
    read('components/resizable-product-sidebar.js'),
    read('app/dashboard-saved.css')
  ])

  assert.match(shell, /ResizableProductSidebar/)
  assert.match(sidebar, /puddle:product-sidebar-width/)
  assert.match(sidebar, /role="separator"/)
  assert.match(sidebar, /ArrowLeft/)
  assert.match(sidebar, /ArrowRight/)
  assert.match(styles, /--minimal-sidebar-width/)
  assert.match(styles, /cursor:col-resize/)
  assert.match(styles, /\.minimal-product-sidebar\.is-expanded/)
})

test('saved places are grouped by location category and perfect picks use persisted discovery events', async () => {
  const [plans, data, styles] = await Promise.all([
    read('app/plans/page.js'),
    read('lib/app/location-plans-data.js'),
    read('app/dashboard-saved.css')
  ])

  assert.match(data, /locations\(id,name,slug,summary,kind,city,cover_path,status\)/)
  assert.match(data, /category: location\.kind \|\| 'other'/)
  assert.match(data, /from\('discovery_context_outbox'\)/)
  assert.match(data, /eq\('event_name', 'perfect'\)/)
  assert.match(plans, /function savedFolders/)
  assert.match(plans, /minimal-saved-folder/)
  assert.match(plans, /★ Perfect Pick/)
  assert.match(plans, /is-perfect-pick/)
  assert.match(styles, /\.minimal-place-card\.is-perfect-pick/)
})

test('root layout loads Vercel Web Analytics and Speed Insights', async () => {
  const [layout, observability] = await Promise.all([
    read('app/layout.js'),
    read('components/vercel-observability.js')
  ])

  assert.match(layout, /VercelObservability/)
  assert.match(observability, /\/_vercel\/insights\/script\.js/)
  assert.match(observability, /\/_vercel\/speed-insights\/script\.js/)
  assert.match(observability, /window\.va/)
  assert.match(observability, /window\.si/)
})
