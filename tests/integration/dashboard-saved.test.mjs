import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8')

test('rebuilt Figma dashboard shell keeps the authored expanded and concise sidebar states accessible', async () => {
  const [shell, sidebar, nav, styles, densityStyles, layout] = await Promise.all([
    read('components/product-shell.js'),
    read('components/figma-dashboard-sidebar.js'),
    read('components/product-nav.js'),
    read('app/figma-dashboard-rebuild.css'),
    read('app/responsive-density-20260822.css'),
    read('app/layout.js')
  ])

  assert.match(shell, /FigmaDashboardSidebar/)
  assert.match(shell, /className="figma-dashboard-shell"/)
  assert.match(shell, /className="figma-dashboard-stage"/)
  assert.match(shell, /<ProductNav mobile avatarUrl=\{avatarUrl\} \/>/)
  assert.doesNotMatch(shell, /ResizableProductSidebar/)

  assert.match(sidebar, /puddle:figma-dashboard-sidebar-width/)
  assert.match(sidebar, /const EXPANDED_WIDTH = 252/)
  assert.match(sidebar, /const CONCISE_WIDTH = 92/)
  assert.match(sidebar, /--figma-shell-sidebar/)
  assert.match(sidebar, /role="separator"/)
  assert.match(sidebar, /ArrowLeft/)
  assert.match(sidebar, /ArrowRight/)
  assert.match(sidebar, /aria-valuetext=\{concise \? 'Concise navigation' : 'Expanded navigation'\}/)
  assert.match(sidebar, /figma-dashboard-sidebar\$\{concise \? ' is-concise' : ' is-expanded'\}/)

  assert.match(nav, /figma-dashboard-nav-item/)
  assert.match(nav, /figma-dashboard-nav-label/)
  assert.match(nav, /figma-dashboard-mobile-nav/)

  assert.match(styles, /--figma-shell-sidebar: 280px/)
  assert.match(styles, /\.figma-dashboard-sidebar\s*\{/)
  assert.match(styles, /width: var\(--figma-shell-sidebar\)/)
  assert.match(styles, /\.figma-dashboard-nav-item\s*\{/)
  assert.match(styles, /width: 241px/)
  assert.match(styles, /height: 56px/)
  assert.match(densityStyles, /\.figma-dashboard-sidebar\.is-concise\s*\{[\s\S]*width:\s*92px !important/)
  assert.match(densityStyles, /\.figma-dashboard-nav-item\s*\{[\s\S]*width:\s*217px !important[\s\S]*height:\s*50px !important/)
  assert.match(layout, /import '\.\/responsive-density-20260822\.css'/)
})

test('saved places hydrate canonical metadata from OpenSearch while Supabase pages relationship state', async () => {
  const [plans, data, styles, layout, cutover] = await Promise.all([
    read('app/plans/page.js'),
    read('lib/app/location-plans-data.js'),
    read('app/plans/Plans.module.css'),
    read('app/layout.js'),
    read('supabase/migrations/20260818204500_lazy_location_refs_cutover.sql')
  ])

  assert.match(data, /LOCATION_HISTORY_PAGE_SIZE = 24/)
  assert.match(data, /location_saved_page_v1/)
  assert.match(data, /getGlobalLocationsByIds/)
  assert.match(data, /openPhotoUrlForHash/)
  assert.match(data, /hydratedLocation/)
  assert.match(data, /location\.kind \|\| 'other'/)
  assert.doesNotMatch(data, /from\('locations'\)/)
  assert.match(cutover, /location_saved_page_v1/)
  assert.match(cutover, /null::text/)

  assert.match(plans, /import styles from '\.\/Plans\.module\.css'/)
  assert.match(plans, /function foldersFor\(items\)/)
  assert.match(plans, /const folders = new Map\(\)/)
  assert.match(plans, /SavedCategoryRail/)
  assert.match(plans, /SavedSearchOverlay/)
  assert.match(plans, /className=\{styles\.categories\}/)
  assert.match(plans, /className=\{styles\.placeCard\} data-testid="saved-card"/)
  assert.match(plans, /className=\{styles\.placeGrid\}/)
  assert.match(plans, /className=\{styles\.perfectPick\}>★ Perfect Pick<\/b>/)
  assert.match(plans, /getLocationPlansPage\(session/)
  assert.match(plans, /data-testid="saved-next-page"/)
  assert.match(plans, /data-testid="saved-screen"/)
  assert.doesNotMatch(plans, /figma-saved-/)
  assert.doesNotMatch(plans, /className=\{styles\.floatingSearch\}/)

  assert.match(styles, /\.placeGrid\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*repeat\(3, minmax\(0, 297px\)\)/s)
  assert.match(styles, /\.placeCard\s*\{[^}]*display:\s*grid;[^}]*grid-template-rows:\s*156px minmax\(0, 1fr\)/s)
  assert.match(styles, /\.placePhoto\s*\{[^}]*position:\s*relative;/s)
  assert.match(styles, /\.perfectPick\s*\{[^}]*position:\s*absolute;/s)
  assert.match(styles, /\.categories > a\.categoryActive\s*\{/)

  assert.doesNotMatch(layout, /figma-dashboard-saved\.css/)
  assert.doesNotMatch(layout, /figma-dashboard-saved-detail-fidelity\.css/)
})
