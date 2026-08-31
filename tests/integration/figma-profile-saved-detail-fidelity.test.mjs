import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8')

test('Profile follows Figma 40:347 with centered identity and a flow-driven two-column card grid', async () => {
  const [page, baseStyles, fidelity, flow, layout] = await Promise.all([
    read('app/(product)/profile/page.js'),
    read('app/figma-dashboard-profile.css'),
    read('app/figma-dashboard-fidelity.css'),
    read('app/figma-dashboard-flow.css'),
    read('app/global.css')
  ])

  assert.match(page, /data-figma-node="40:347"/)
  assert.match(page, /<div className="figma-profile-identity">\s*<h1>\{displayName\}<\/h1>/)
  assert.doesNotMatch(page, /figma-profile-name-row/)
  assert.doesNotMatch(page, /figma-profile-pass-badge/)
  assert.doesNotMatch(page, /figma-profile-edit/)
  assert.doesNotMatch(page, /figma-profile-add-card/)

  // The profile card relationship is represented structurally rather than with page x/y coordinates.
  assert.match(page, /figma-profile-card-column figma-profile-card-column--left/)
  assert.match(page, /figma-profile-card-column figma-profile-card-column--right/)
  const leftColumn = page.indexOf('figma-profile-card-column--left')
  const puddles = page.indexOf('figma-profile-puddles-card', leftColumn)
  const friends = page.indexOf('figma-profile-friends-card', puddles)
  const rightColumn = page.indexOf('figma-profile-card-column--right')
  const location = page.indexOf('figma-profile-location-card', rightColumn)
  const saves = page.indexOf('figma-profile-saves-card', location)
  assert.ok(leftColumn >= 0 && puddles > leftColumn && friends > puddles, 'left Figma column must be Puddles → Friends')
  assert.ok(rightColumn > leftColumn && location > rightColumn && saves > location, 'right profile column must be Location → Saves')

  assert.match(flow, /\.figma-profile-cards\s*\{[^}]*position:\s*relative\s*!important;[^}]*display:\s*grid;[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 369px\)\);/s)
  assert.match(flow, /\.figma-profile-card-column\s*\{[^}]*display:\s*grid;[^}]*gap:\s*20px;/s)
  assert.match(flow, /\.figma-profile-card\s*\{[^}]*position:\s*relative\s*!important;[^}]*width:\s*100%\s*!important;[^}]*height:\s*auto\s*!important;/s)
  assert.match(flow, /\.figma-profile-puddles-card\s*\{\s*min-height:\s*378px;/)
  assert.match(flow, /\.figma-profile-location-card\s*\{\s*min-height:\s*239px;/)
  assert.match(flow, /\.figma-profile-saves-card\s*\{\s*min-height:\s*494px;/)
  assert.match(flow, /\.figma-profile-friends-card\s*\{\s*min-height:\s*460px;/)
  assert.match(flow, /@media \(max-width: 760px\)[\s\S]*\.figma-profile-cards\s*\{[^}]*grid-template-columns:\s*1fr;/)

  // Exact Figma styling remains visual-only and local to components.
  assert.match(fidelity, /\.figma-profile-hero\s*\{[^}]*border:\s*4px solid #fff;[^}]*background:\s*var\(--profile-theme, #4ca5f7\);/s)
  assert.match(fidelity, /\.figma-profile-avatar-editor > summary\s*\{[^}]*width:\s*133px;[^}]*height:\s*133px;/s)
  assert.match(fidelity, /font:\s*800 44\.429px\/1\.15 Manrope/)
  assert.match(fidelity, /\.figma-profile-actions a\s*\{[^}]*width:\s*218px;[^}]*height:\s*50px;/s)
  assert.match(fidelity, /\.figma-profile-puddles-card > h2\s*\{\s*color:\s*#f2c035;/)
  assert.match(fidelity, /\.figma-profile-saves-card > h2\s*\{\s*color:\s*#b784e4;/)
  assert.match(baseStyles, /\.figma-profile-screen/)

  const functionalIndex = layout.indexOf("import './functional-completion.css'")
  const fidelityIndex = layout.indexOf("import './figma-dashboard-fidelity.css'")
  const flowIndex = layout.indexOf("import './figma-dashboard-flow.css'")
  assert.ok(functionalIndex >= 0 && fidelityIndex > functionalIndex, 'consolidated Figma fidelity must load after functional overrides')
  assert.ok(flowIndex > fidelityIndex, 'flow mechanics must load last so stale page-level coordinates cannot win')
  assert.doesNotMatch(layout, /figma-dashboard-profile-fidelity\.css/)
})

test('Profile save count uses the full saved-location relation, not the preview page', async () => {
  const page = await read('app/(product)/profile/page.js')
  const counts = page.slice(page.indexOf('figma-profile-counts'), page.indexOf('figma-profile-chips'))

  assert.match(page, /async function savedLocationCountOrNull\(supabase, profileId\)/)
  assert.match(page, /\.select\('location_id', \{ count: 'exact', head: true \}\)/)
  assert.match(page, /\.eq\('state', 'saved'\)/)
  assert.match(page, /\.not\('location_id', 'is', null\)/)
  assert.match(counts, /savedLocationCount/)
  assert.doesNotMatch(counts, /visibleSaves\.length/)
})

test('Saved Place Open preserves Figma 38:223 relationships through scoped structural layout', async () => {
  const [page, similar, reviews, share, styles, layout] = await Promise.all([
    read('app/(product)/plans/[slug]/page.js'),
    read('app/(product)/plans/[slug]/similar-places.js'),
    read('app/(product)/plans/[slug]/detail-reviews.js'),
    read('app/(product)/plans/[slug]/detail-share-menu.js'),
    read('app/(product)/plans/Plans.module.css'),
    read('app/global.css')
  ])

  assert.match(page, /import styles from '\.\.\/Plans\.module\.css'/)
  assert.match(page, /import \{ getLocationPlanStatus \} from '@\/lib\/app\/location-plans-data'/)
  assert.doesNotMatch(page, /getLocationPlansPage/)
  assert.match(page, /getLocationPlanStatus\(session, location\.id\)/)
  assert.doesNotMatch(page, /getLocationPlansSnapshot/)
  assert.match(page, /data-figma-node="38:223"/)
  assert.match(page, /data-testid="saved-detail-screen"/)
  assert.match(page, /className=\{styles\.detailCategories\}/)
  assert.match(page, />All<\/Link>/)
  assert.match(page, /folders\.map\(\(folder\) => <Link href=\{`\/plans\?tab=saved&category=/)
  assert.doesNotMatch(page, /primaryFolders|overflowFolders|More saved categories|moreCategories/)
  assert.match(page, /className=\{styles\.detailActions\}/)
  assert.match(page, /className=\{styles\.detailTitle\}/)
  assert.match(page, /Price varies/)
  assert.match(page, /Local spot/)
  assert.match(reviews, /className=\{styles\.reviews\}/)
  assert.match(reviews, /location_reviews_v1/)
  assert.match(share, /social_friend_picker_v2/)
  assert.doesNotMatch(page, /location_reviews_v1|social_friends_v2/)
  assert.match(page, /className=\{styles\.detailMap\}/)
  assert.match(page, /<SimilarPlaces slug=\{slug\} \/>/)
  assert.match(similar, /useEffect/)
  assert.match(similar, /\/api\/public-location\/\$\{encodeURIComponent\(slug\)\}\/similar/)
  assert.doesNotMatch(page, /figma-saved-detail-kicker/)
  assert.doesNotMatch(page, /figma-saved-detail-description/)
  assert.doesNotMatch(page, /figma-saved-detail-tags/)

  assert.match(styles, /\.detailCard\s*\{[^}]*width:\s*min\(calc\(100% - 2rem\), 60rem\);[^}]*min-height:\s*0;[^}]*height:\s*auto;[^}]*display:\s*grid;[^}]*grid-template-columns:\s*minmax\(0, 1\.42fr\) minmax\(16rem, 1fr\);/s)
  assert.match(styles, /\.detailMedia\s*\{[^}]*width:\s*100%;[^}]*height:\s*auto;[^}]*aspect-ratio:\s*529 \/ 263;/s)
  assert.match(styles, /\.detailActions\s*\{[^}]*min-height:\s*2\.4375rem;[^}]*height:\s*auto;[^}]*display:\s*flex;/s)
  assert.match(styles, /\.detailTitle\s*\{[^}]*width:\s*100%;[^}]*min-height:\s*clamp\([^}]*font:\s*800 clamp\(/s)
  assert.match(styles, /\.detailMeta\s*\{[^}]*grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\)/s)
  assert.match(styles, /\.planVisit\s*\{[^}]*width:\s*max-content;[^}]*height:\s*auto;/s)
  assert.match(styles, /\.reviews\s*\{[^}]*width:\s*100%;[^}]*min-height:\s*20\.75rem;[^}]*max-height:\s*clamp\(/s)
  assert.match(styles, /\.detailMap\s*\{[^}]*width:\s*100%;[^}]*min-height:\s*0;[^}]*height:\s*auto;[^}]*aspect-ratio:\s*370 \/ 583;/s)
  assert.match(styles, /\.similarGrid\s*\{[^}]*grid-template-columns:\s*repeat\(auto-fit, minmax\(/s)
  assert.match(styles, /\.detailSearch\s*\{[^}]*position:\s*static;[^}]*width:\s*min\(26\.25rem, calc\(100% - 2rem\)\);/s)
  assert.match(reviews, /className=\{styles\.reviewEditor\}/)
  assert.match(reviews, /className=\{styles\.reviewBodyInput\}/)
  assert.doesNotMatch(reviews, /style=\{\{/)

  assert.doesNotMatch(layout, /figma-dashboard-saved\.css/)
  assert.doesNotMatch(layout, /figma-dashboard-saved-detail-fidelity\.css/)
})

test('Saved detail media and secondary reads expose resilient user-facing states', async () => {
  const [page, reviews, similar, photoFrame, styles, morph] = await Promise.all([
    read('app/(product)/plans/[slug]/page.js'),
    read('app/(product)/plans/[slug]/detail-reviews.js'),
    read('app/(product)/plans/[slug]/similar-places.js'),
    read('components/photo-frame.js'),
    read('app/(product)/plans/Plans.module.css'),
    read('components/saved-location-morph-bridge.js')
  ])

  assert.match(page, /<PhotoFrame[\s\S]*detailHero/)
  assert.match(page, /fetchPriority="high"/)
  assert.match(reviews, /setRetry/)
  assert.match(reviews, /Loading reviews…/)
  assert.match(reviews, /Reviews could not be loaded\./)
  assert.match(reviews, /Try again/)
  assert.match(similar, /setRetry/)
  assert.match(similar, /Loading similar places…/)
  assert.match(similar, /Recommendations could not be loaded\./)
  assert.doesNotMatch(similar, /error\?\.message/)
  assert.match(similar, /PhotoFrame as="span"/)
  assert.match(similar, /content_kind !== 'event'/)
  assert.match(similar, /`\/places\/\$\{encodeURIComponent\(item\.slug\)\}`/)
  assert.doesNotMatch(similar, /\/events\//)
  assert.match(photoFrame, /onError=\{\(\) => setFailed\(true\)\}/)
  assert.match(photoFrame, /onLoad=\{\(\) => setLoaded\(true\)\}/)
  assert.match(photoFrame, /data-photo-state=\{state\}/)
  assert.match(photoFrame, /Photo unavailable/)
  assert.match(styles, /\.detailHero > img/)
  assert.match(styles, /\.detailHeroUnavailable/)
  assert.match(styles, /\.similarPhoto > img/)
  assert.match(styles, /\.similarPhotoUnavailable/)
  assert.match(styles, /\.reviewStatusError/)
  assert.match(morph, /className="saved-inline-detail-hero" data-inline-morph-photo/)
  assert.match(morph, /saved-inline-detail-similar-photo/)
  assert.match(morph, /content_kind !== 'event'/)
  assert.match(morph, /`\/places\/\$\{encodeURIComponent\(item\.slug\)\}`/)
  assert.doesNotMatch(morph, /\/events\//)
  assert.match(morph, /detailError/)
  assert.match(morph, /Saved details could not be loaded\./)
  assert.match(morph, /onRetry=\{retryDetail\}/)
})
