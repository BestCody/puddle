import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8')

test('Discover keeps a bounded rolling preload window and refills before the deck runs dry', async () => {
  const [workspace, preloader, rum] = await Promise.all([
    read('components/date-swipe-workspace-v2.js'),
    read('components/discovery-photo-preloader.js'),
    read('components/discovery-rum.js')
  ])

  assert.match(workspace, /const DECK_BATCH_SIZE = 12/)
  assert.match(workspace, /const CONTINUATION_BATCH_SIZE = 16/)
  assert.match(workspace, /const PREFETCH_THRESHOLD = 10/)
  assert.match(workspace, /const REFILL_THRESHOLD = 5/)
  assert.match(workspace, /const continuationPrefetchInFlight = useRef\(null\)/)
  assert.match(workspace, /const prefetchedContinuation = useRef\(null\)/)
  assert.match(workspace, /const prefetchMore = useCallback/)
  assert.match(workspace, /timedDiscoveryRequest/)
  assert.match(workspace, /const PHOTO_PRELOAD_AHEAD = 2/)
  assert.match(workspace, /remaining <= PREFETCH_THRESHOLD\) prefetchMore\(\)/)
  assert.match(workspace, /const remaining = Math\.max\(0, feed\.items\.length - index\)/)
  assert.match(workspace, /remaining <= REFILL_THRESHOLD\) loadMore\(\)/)
  assert.match(workspace, /<DiscoveryPhotoPreloader items=\{feed\.items\} index=\{index\} ahead=\{PHOTO_PRELOAD_AHEAD\} \/>/)

  assert.match(rum, /import \{ track \} from '@vercel\/analytics'/)
  assert.match(rum, /track\('discovery_rum', properties\)/)
  assert.match(rum, /DISCOVERY_RUM_SAMPLE_RATE = 0\.1/)
  assert.match(rum, /x-puddle-region/)
  assert.match(rum, /server_\$\{name\}_ms/)
  assert.match(rum, /reportInitialDiscoveryNavigation/)

  assert.match(preloader, /item\.photo_urls/)
  assert.match(preloader, /item\.photo_url/)
  assert.match(preloader, /item\.cover_url/)
  assert.doesNotMatch(preloader, /category_placeholder_url|google_photo_proxy_url|google_client_lookup/)
  assert.match(preloader, /connection\?\.saveData/)
  assert.match(preloader, /effectiveType === 'slow-2g' \|\| effectiveType === '2g'/)
  assert.match(preloader, /image\.fetchPriority = 'low'/)
  assert.match(preloader, /getImageProps/)
  assert.match(preloader, /DISCOVERY_IMAGE_SIZES/)
  assert.match(preloader, /image\.srcset = source\.srcSet/)
})

test('dashboard navigation warms intent targets plus at most two bounded idle hints', async () => {
  const nav = await read('components/product-nav.js')

  assert.match(nav, /useEffect, useRef, useState/)
  assert.match(nav, /usePathname, useRouter/)
  assert.match(nav, /prefetch=\{false\}/)
  assert.match(nav, /router\.prefetch\(href/)
  assert.match(nav, /onMouseEnter=\{\(\) => warmRoute\(item\.href\)\}/)
  assert.match(nav, /onFocus=\{\(\) => warmRoute\(item\.href\)\}/)
  assert.match(nav, /onPointerDown=\{\(event\) => \{[\s\S]*warmRoute\(item\.href\)/)
  assert.match(nav, /const IDLE_ROUTE_HINTS = \{/)
  assert.match(nav, /const IDLE_PREFETCH_DELAY_MS = 900/)
  assert.match(nav, /\.slice\(0, 2\)/)
  assert.match(nav, /requestIdleCallback/)
  assert.match(nav, /connection\?\.saveData/)
  assert.match(nav, /effectiveType === 'slow-2g'/)
  assert.doesNotMatch(nav, /backgroundWarmupStarted|items\s*\.map\(\(item\) => item\.href\)/)
  assert.match(nav, /const \[selectedHref, setSelectedHref\] = useState\(routeActiveHref\)/)
  assert.match(nav, /const navigationIntentRef = useRef\(null\)/)
  assert.match(nav, /function selectImmediately\(event, href\)[\s\S]*setSelectedHref\(href\)/)
  assert.match(nav, /onPointerDown=\{\(event\) => \{[\s\S]*selectImmediately\(event, item\.href\)/)
  assert.match(nav, /setSelectedHref\(href\)[\s\S]*beginMainContentLoading\(\)/)
  assert.match(nav, /const active = item\.href === selectedHref/)
  assert.doesNotMatch(nav, /pendingHref|setPendingHref/)
  assert.match(nav, /\{ href: '\/map', label: 'Feed'/)
  assert.doesNotMatch(nav, /label: 'Discover'|activeLabel: 'Explore'/)
})

test('top pills size to their labels and move their highlight before navigation completes', async () => {
  const [routed, sidebarStyles, targetedStyles, mapPage, plansPage, passPage, layout] = await Promise.all([
    read('components/routed-segment.js'),
    read('app/sidebar-interactions.css'),
    read('app/ui-targeted-fixes.css'),
    read('components/map-route-client.js'),
    read('app/(product)/plans/page.js'),
    read('app/(product)/membership/page.js'),
    read('app/layout.js')
  ])

  assert.match(routed, /useLayoutEffect/)
  assert.match(routed, /active\.offsetLeft/)
  assert.match(routed, /active\.offsetWidth/)
  assert.match(routed, /data-segment-enhanced="true"/)
  assert.match(routed, /data-segment-count/)
  assert.match(routed, /onPointerDown=\{\(event\) =>/)
  assert.doesNotMatch(layout, /segment-interaction-bridge|instant-segment/)
  assert.match(layout, /import '\.\/ui-targeted-fixes\.css'/)

  assert.match(targetedStyles, /width:\s*max-content !important/)
  assert.match(targetedStyles, /min-width:\s*max-content !important/)
  assert.match(targetedStyles, /height:\s*48px !important/)
  assert.match(targetedStyles, /font-size:\s*16px !important/)
  assert.doesNotMatch(targetedStyles, /width:\s*167px !important/)
  assert.match(targetedStyles, /left 145ms/)
  assert.match(targetedStyles, /width 145ms/)

  assert.match(mapPage, /\{ value: 'feed', label: 'Feed', href: '\/map' \}/)
  assert.match(mapPage, /tone="yellow"/)
  assert.match(mapPage, /<SocialFeedClient/)
  assert.match(mapPage, /<LocationMap[\s\S]*loadCatalogue/)
  assert.match(mapPage, /useSearchParams/)
  assert.doesNotMatch(mapPage, /getSocialFeedSnapshot/)
  assert.doesNotMatch(mapPage, /await Promise\.all\(\[mapPromise, feedPromise\]\)/)
  assert.match(plansPage, /tone="purple"/)
  assert.match(passPage, /tone="pink"/)
})

test('Saved cards reflow responsively without changing their card content', async () => {
  const [plansPage, targetedStyles] = await Promise.all([
    read('app/(product)/plans/page.js'),
    read('app/ui-targeted-fixes.css')
  ])

  assert.match(plansPage, /data-testid="saved-grid"/)
  assert.match(plansPage, /data-testid="saved-card"/)
  assert.match(targetedStyles, /repeat\(auto-fit, minmax\(min\(260px, 100%\), 1fr\)\)/)
  assert.match(targetedStyles, /\[data-testid="saved-grid"\] > \[data-testid="saved-card"\][\s\S]*width:\s*100% !important/)
  assert.match(targetedStyles, /transform:\s*none !important/)
})

test('Settings opens over the current page and Swipe locks only page scrolling', async () => {
  const [sidebar, shell, overlay, accountPage, targetedStyles] = await Promise.all([
    read('components/figma-dashboard-sidebar.js'),
    read('components/product-shell.js'),
    read('components/settings-overlay.js'),
    read('app/account/page.js'),
    read('app/ui-targeted-fixes.css')
  ])

  assert.match(sidebar, /<SettingsTrigger className="figma-dashboard-settings-link">[\s\S]*figma-dashboard-settings-label">Settings<\/span>[\s\S]*<\/SettingsTrigger>/)
  assert.match(shell, /<SettingsOverlay \/>/)
  assert.match(shell, /<SettingsTrigger>Settings<\/SettingsTrigger>/)
  assert.match(overlay, /window\.self !== window\.top/)
  assert.match(overlay, /src="\/account\?embedded=1&returnTo=%2Fprofile"/)
  assert.match(overlay, /puddle-settings-overlay-open/)
  assert.match(overlay, /role="dialog" aria-modal="true" aria-label="Settings"/)
  assert.match(overlay, /inert=\{!open\}/)
  assert.match(overlay, /FRAME_FOCUSABLE_SELECTOR/)
  assert.match(overlay, /event\.key === 'Escape'/)
  assert.match(overlay, /element\.inert = true/)
  assert.match(overlay, /contentDocument/)
  assert.match(accountPage, /const embedded = params\?\.embedded === '1'/)
  assert.match(accountPage, /settingsOverlay=\{!embedded\}/)
  assert.match(accountPage, /figma-settings-screen\$\{embedded \? ' is-embedded' : ''\}/)
  assert.match(targetedStyles, /backdrop-filter:\s*blur\(12px\)/)
  assert.match(targetedStyles, /body:has\(\.figma-settings-screen\.is-embedded\) \.figma-dashboard-sidebar/)
  assert.match(targetedStyles, /\.puddle-settings-overlay-frame[\s\S]*opacity:\s*1/)
  assert.match(targetedStyles, /html:has\(\.figma-swipe-screen\)/)
  assert.match(targetedStyles, /overflow:\s*hidden !important/)
  assert.doesNotMatch(targetedStyles, /touch-action:\s*none/)
})

test('Puddle logo toggles a persisted comprehensive dark mode without recoloring branded content', async () => {
  const [layout, shell, sidebar, toggle, actions, darkStyles] = await Promise.all([
    read('app/layout.js'),
    read('components/product-shell.js'),
    read('components/figma-dashboard-sidebar.js'),
    read('components/appearance-toggle-logo.js'),
    read('app/account/actions.js'),
    read('app/dark-mode.css')
  ])

  assert.match(layout, /import '\.\/ui-targeted-fixes\.css'\s*\nimport '\.\/dark-mode\.css'/)
  assert.match(layout, /colorScheme:\s*'light dark'/)
  assert.match(shell, /data-appearance=\{appearance\}/)
  assert.match(shell, /<FigmaDashboardSidebar avatarUrl=\{avatarUrl\} initialAppearance=\{appearance\} \/>/)
  assert.match(sidebar, /<AppearanceToggleLogo initialAppearance=\{initialAppearance\} \/>/)

  assert.match(toggle, /shell\.dataset\.appearance = appearance/)
  assert.match(toggle, /shell\.dataset\.resolvedAppearance = resolved/)
  assert.match(toggle, /const nextAppearance = currentResolved === 'dark' \? 'light' : 'dark'/)
  assert.match(toggle, /applyAppearance\(shell, nextAppearance\)[\s\S]*setAppearanceThemeFromLogo\(nextAppearance\)/)
  assert.match(toggle, /sessionStorage\.setItem\(PENDING_KEY, nextAppearance\)/)
  assert.match(toggle, /aria-label="Toggle light and dark mode"/)

  assert.match(actions, /export async function setAppearanceThemeFromLogo\(theme\)/)
  assert.match(actions, /appearance_theme:\s*appearanceTheme/)
  assert.match(actions, /revalidateAppearancePaths\(\)/)

  assert.match(darkStyles, /--puddle-dark-bg:\s*#111315/)
  assert.match(darkStyles, /--puddle-dark-raised:\s*#202428/)
  assert.match(darkStyles, /\[data-testid="feed-screen"\]:not\(\[data-view="map"\]\)/)
  assert.match(darkStyles, /\[data-testid="saved-screen"\]/)
  assert.match(darkStyles, /\.figma-friends-conversations/)
  assert.match(darkStyles, /\.figma-pass-plan:not\(\.figma-pass-plan-paid\)/)
  assert.match(darkStyles, /\.figma-profile-screen/)
  assert.match(darkStyles, /\.figma-create-post-card/)
  assert.match(darkStyles, /\.figma-settings-window/)
  assert.doesNotMatch(darkStyles, /filter:\s*(?:invert|grayscale|brightness)\(/)
})

test('dashboard navigation keeps the shell mounted, preserves UI, and streams route content after auth', async () => {
  const [transition, nav, shell, renderPage, styles, sidebarStyles, layout, productLayout, productLoading] = await Promise.all([
    read('components/main-content-transition.js'),
    read('components/product-nav.js'),
    read('components/product-shell.js'),
    read('lib/app/render-product-page.js'),
    read('app/performance-loading.css'),
    read('app/sidebar-interactions.css'),
    read('app/layout.js'),
    read('app/(product)/layout.js'),
    read('app/(product)/loading.js')
  ])

  assert.match(layout, /import '\.\/performance-loading\.css'/)
  assert.match(layout, /import '\.\/sidebar-interactions\.css'/)
  assert.match(productLayout, /export default function ProductLayout/)
  assert.match(productLayout, /<StaticProductShell>\{children\}<\/StaticProductShell>/)
  assert.doesNotMatch(productLayout, /requireUser|<ProductShell user=/)
  assert.match(productLoading, /puddle-main-transition-loader/)
  assert.match(shell, /import \{ MainContentTransition \} from '\.\/main-content-transition'/)
  assert.match(shell, /<FigmaDashboardSidebar avatarUrl=\{avatarUrl\} initialAppearance=\{appearance\} \/>[\s\S]*<main className="figma-dashboard-main"><MainContentTransition>\{content\}<\/MainContentTransition><\/main>/)

  assert.match(renderPage, /import \{ Suspense \} from 'react'/)
  assert.match(renderPage, /function PersistentRouteFallback\(\)/)
  assert.match(renderPage, /<Suspense fallback=\{<PersistentRouteFallback \/>\}>/)
  assert.match(renderPage, /<AwaitRouteContent contentPromise=\{contentPromise\} \/>/)
  assert.doesNotMatch(renderPage, /usesPersistentProductShell\(\)\) return contentPromise/)

  assert.match(transition, /export const MAIN_CONTENT_LOADING_EVENT = 'puddle:main-content-loading'/)
  assert.match(transition, /window\.dispatchEvent\(new Event\(MAIN_CONTENT_LOADING_EVENT\)\)/)
  assert.match(transition, /function startLoading\(\) \{\s*setLoading\(true\)\s*\}/)
  assert.doesNotMatch(transition, /SPINNER_DELAY_MS|setTimeout|clearTimeout/)
  assert.match(transition, /setLoading\(false\)/)
  assert.match(transition, /puddle-main-transition-loader/)
  assert.match(transition, /puddle-main-spinner/)

  assert.match(nav, /beginMainContentLoading\(\)/)
  assert.match(nav, /onClick=\{\(event\) => startNavigation\(event, item\.href\)\}/)

  assert.match(sidebarStyles, /\.figma-dashboard-nav-item:not\(\.is-active\):hover/)
  assert.match(sidebarStyles, /background:\s*#d7d7d7/)
  assert.match(sidebarStyles, /border-color:\s*#c4c4c4/)
  assert.match(sidebarStyles, /color:\s*var\(--figma-grey\)/)
  assert.match(sidebarStyles, /\.figma-dashboard-nav-item\.is-active[\s\S]*filter:\s*brightness\(1\.08\)/)

  assert.match(styles, /\.puddle-main-transition\.is-loading \.puddle-main-transition-content/)
  assert.match(styles, /\.puddle-main-transition-loader/)
  assert.match(styles, /\.puddle-main-spinner/)
  assert.doesNotMatch(styles, /\.product-route-loading-/)
})
