import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8')

test('Discover keeps a bounded rolling preload window and refills before the deck runs dry', async () => {
  const [workspace, preloader] = await Promise.all([
    read('components/date-swipe-workspace-v2.js'),
    read('components/discovery-photo-preloader.js')
  ])

  assert.match(workspace, /const DECK_BATCH_SIZE = 12/)
  assert.match(workspace, /const REFILL_THRESHOLD = 5/)
  assert.match(workspace, /const PHOTO_PRELOAD_AHEAD = 2/)
  assert.match(workspace, /Math\.max\(0, feed\.items\.length - index\) <= REFILL_THRESHOLD/)
  assert.match(workspace, /<DiscoveryPhotoPreloader items=\{feed\.items\} index=\{index\} ahead=\{PHOTO_PRELOAD_AHEAD\} \/>/)

  assert.match(preloader, /item\.photo_urls/)
  assert.match(preloader, /item\.photo_url/)
  assert.match(preloader, /item\.cover_url/)
  assert.match(preloader, /item\?\.category_placeholder_url/)
  assert.doesNotMatch(preloader, /google_photo_proxy_url|google_client_lookup/)
  assert.match(preloader, /connection\?\.saveData/)
  assert.match(preloader, /effectiveType === 'slow-2g' \|\| effectiveType === '2g'/)
  assert.match(preloader, /image\.fetchPriority = 'low'/)
  assert.match(preloader, /getImageProps/)
  assert.match(preloader, /DISCOVERY_IMAGE_SIZES/)
  assert.match(preloader, /image\.srcset = source\.srcSet/)
})

test('dashboard navigation warms only intent-targeted routes and selects exactly one item immediately', async () => {
  const nav = await read('components/product-nav.js')

  assert.match(nav, /useEffect, useRef, useState/)
  assert.match(nav, /usePathname, useRouter/)
  assert.match(nav, /prefetch=\{false\}/)
  assert.match(nav, /router\.prefetch\(href/)
  assert.match(nav, /onMouseEnter=\{\(\) => warmRoute\(item\.href\)\}/)
  assert.match(nav, /onFocus=\{\(\) => warmRoute\(item\.href\)\}/)
  assert.match(nav, /onPointerDown=\{\(event\) => \{[\s\S]*warmRoute\(item\.href\)/)
  assert.doesNotMatch(nav, /BACKGROUND_PREFETCH|backgroundWarmupStarted|requestIdleCallback|connection\?\.saveData/)
  assert.match(nav, /const \[selectedHref, setSelectedHref\] = useState\(routeActiveHref\)/)
  assert.match(nav, /const navigationIntentRef = useRef\(null\)/)
  assert.match(nav, /function selectImmediately\(event, href\)[\s\S]*setSelectedHref\(href\)/)
  assert.match(nav, /onPointerDown=\{\(event\) => \{[\s\S]*selectImmediately\(event, item\.href\)/)
  assert.match(nav, /setSelectedHref\(href\)[\s\S]*beginMainContentLoading\(\)/)
  assert.match(nav, /const active = item\.href === selectedHref/)
  assert.doesNotMatch(nav, /pendingHref|setPendingHref/)
  assert.match(nav, /\{ href: '\/map', label: 'Discover'/)
  assert.doesNotMatch(nav, /label: 'Feed'|activeLabel: 'Explore'/)
})

test('top pills size to their labels and move their highlight before navigation completes', async () => {
  const [segment, bridge, sidebarStyles, targetedStyles, mapPage, plansPage, passPage, layout] = await Promise.all([
    read('components/instant-segment.js'),
    read('components/segment-interaction-bridge.js'),
    read('app/sidebar-interactions.css'),
    read('app/ui-targeted-fixes.css'),
    read('app/(product)/map/page.js'),
    read('app/(product)/plans/page.js'),
    read('app/(product)/membership/page.js'),
    read('app/layout.js')
  ])

  assert.match(segment, /useLayoutEffect/)
  assert.match(segment, /active\.offsetLeft/)
  assert.match(segment, /active\.offsetWidth/)
  assert.match(segment, /--segment-active-left/)
  assert.match(segment, /--segment-active-width/)
  assert.match(segment, /onPointerDown=\{\(event\) =>/)

  assert.match(bridge, /active\.offsetLeft/)
  assert.match(bridge, /active\.offsetWidth/)
  assert.match(bridge, /document\.addEventListener\('pointerdown', onPointerDown, true\)/)
  assert.match(layout, /import '\.\/ui-targeted-fixes\.css'/)

  assert.match(targetedStyles, /width:\s*max-content !important/)
  assert.match(targetedStyles, /min-width:\s*max-content !important/)
  assert.match(targetedStyles, /height:\s*48px !important/)
  assert.match(targetedStyles, /font-size:\s*16px !important/)
  assert.doesNotMatch(targetedStyles, /width:\s*167px !important/)
  assert.match(targetedStyles, /left 145ms/)
  assert.match(targetedStyles, /width 145ms/)

  assert.match(mapPage, /\{ value: 'feed', label: 'Posts', href: '\/map' \}/)
  assert.match(mapPage, /tone="yellow"/)
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

test('dashboard navigation keeps the shell mounted, preserves UI, and shows loading immediately', async () => {
  const [transition, nav, shell, styles, sidebarStyles, layout, productLayout, productLoading] = await Promise.all([
    read('components/main-content-transition.js'),
    read('components/product-nav.js'),
    read('components/product-shell.js'),
    read('app/performance-loading.css'),
    read('app/sidebar-interactions.css'),
    read('app/layout.js'),
    read('app/(product)/layout.js'),
    read('app/(product)/loading.js')
  ])

  assert.match(layout, /import '\.\/performance-loading\.css'/)
  assert.match(layout, /import '\.\/sidebar-interactions\.css'/)
  assert.match(productLayout, /export default async function ProductLayout/)
  assert.match(productLayout, /<ProductShell user=\{session\.user\} profile=\{session\.profile\}>\{children\}<\/ProductShell>/)
  assert.match(productLoading, /puddle-main-transition-loader/)
  assert.match(shell, /import \{ MainContentTransition \} from '\.\/main-content-transition'/)
  assert.match(shell, /<FigmaDashboardSidebar avatarUrl=\{avatarUrl\} initialAppearance=\{appearance\} \/>[\s\S]*<main className="figma-dashboard-main"><MainContentTransition>\{content\}<\/MainContentTransition><\/main>/)

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
