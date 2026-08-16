import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8')

test('Profile follows the authored Figma 40:347 center axis and card geometry', async () => {
  const [page, styles, layout] = await Promise.all([
    read('app/profile/page.js'),
    read('app/figma-dashboard-profile-fidelity.css'),
    read('app/layout.js')
  ])

  assert.match(page, /data-figma-node="40:347"/)
  assert.match(page, /<div className="figma-profile-identity">\s*<h1>\{displayName\}<\/h1>/)
  assert.doesNotMatch(page, /figma-profile-name-row/)
  assert.doesNotMatch(page, /figma-profile-pass-badge/)

  assert.match(styles, /\.figma-profile-hero\s*\{[^}]*left:\s*42px;[^}]*width:\s*897px;[^}]*height:\s*318px;/s)
  assert.match(styles, /\.figma-profile-avatar-editor > summary\s*\{[^}]*top:\s*207px;[^}]*left:\s*371px;[^}]*width:\s*133px;[^}]*height:\s*133px;/s)
  assert.match(styles, /\.figma-profile-identity\s*\{[^}]*left:\s*437\.5px;[^}]*width:\s*620px;[^}]*text-align:\s*center;/s)
  assert.match(styles, /font:\s*800 44\.429px\/1\.15 Manrope/)
  assert.match(styles, /\.figma-profile-actions a\s*\{[^}]*width:\s*218px;[^}]*height:\s*50px;/s)
  assert.match(styles, /\.figma-profile-puddles-card > h2\s*\{\s*color:\s*#f2c035;/)
  assert.match(styles, /\.figma-profile-saves-card > h2\s*\{\s*color:\s*#b784e4;/)

  const functionalIndex = layout.indexOf("import './functional-completion.css'")
  const fidelityIndex = layout.indexOf("import './figma-dashboard-profile-fidelity.css'")
  assert.ok(functionalIndex >= 0 && fidelityIndex > functionalIndex, 'Profile fidelity must load after functional overrides')
})

test('Saved Place Open preserves Figma 38:223 relationships through scoped structural layout', async () => {
  const [page, styles, layout] = await Promise.all([
    read('app/plans/[slug]/page.js'),
    read('app/plans/Plans.module.css'),
    read('app/layout.js')
  ])

  assert.match(page, /import styles from '\.\.\/Plans\.module\.css'/)
  assert.match(page, /data-figma-node="38:223"/)
  assert.match(page, /data-testid="saved-detail-screen"/)
  assert.match(page, /className=\{styles\.detailCategories\}/)
  assert.match(page, />All<\/Link>/)
  assert.match(page, />Courts<\/Link>/)
  assert.match(page, />Theatres<\/Link>/)
  assert.match(page, /className=\{styles\.detailActions\}/)
  assert.match(page, /className=\{styles\.detailTitle\}/)
  assert.match(page, /Price varies/)
  assert.match(page, /Local spot/)
  assert.match(page, /className=\{styles\.reviews\}/)
  assert.match(page, /className=\{styles\.detailMap\}/)
  assert.doesNotMatch(page, /figma-saved-detail-kicker/)
  assert.doesNotMatch(page, /figma-saved-detail-description/)
  assert.doesNotMatch(page, /figma-saved-detail-tags/)

  assert.match(styles, /\.detailTopbar\s*\{[^}]*height:\s*109px;[^}]*display:\s*grid;/s)
  assert.match(styles, /\.detailCategoryBand\s*\{[^}]*height:\s*49px;/s)
  assert.match(styles, /\.detailCard\s*\{[^}]*width:\s*min\(962px, calc\(100% - 38px\)\);[^}]*height:\s*970px;[^}]*margin:\s*15px 22px 0 16px;[^}]*display:\s*grid;[^}]*grid-template-columns:\s*529px 370px;/s)
  assert.match(styles, /\.detailMedia\s*\{[^}]*width:\s*529px;[^}]*height:\s*263px;/s)
  assert.match(styles, /\.detailActions\s*\{[^}]*margin:\s*-23px 0 0 12px;/s)
  assert.match(styles, /\.detailTitle\s*\{[^}]*width:\s*546px;[^}]*height:\s*150px;[^}]*margin:\s*23px 0 0 6\.9px;[^}]*font:\s*800 64px\/1 Manrope/s)
  assert.match(styles, /\.detailMeta\s*\{[^}]*grid-template-columns:\s*131px 179px 155px;/s)
  assert.match(styles, /\.planVisit\s*\{[^}]*margin:\s*24px 0 0 5px;/s)
  assert.match(styles, /\.reviews\s*\{[^}]*width:\s*533px;[^}]*height:\s*332px;[^}]*margin:\s*22px 0 0 5px;/s)
  assert.match(styles, /\.detailMap\s*\{[^}]*width:\s*370px;[^}]*height:\s*583px;/s)
  assert.match(styles, /\.similarGrid\s*\{[^}]*grid-template-columns:\s*repeat\(3, minmax\(0, 308\.435px\)\)/s)
  assert.match(styles, /\.detailSearch\s*\{[^}]*position:\s*static;[^}]*margin:\s*22px 0 0 273px;/s)

  assert.doesNotMatch(layout, /figma-dashboard-saved\.css/)
  assert.doesNotMatch(layout, /figma-dashboard-saved-detail-fidelity\.css/)
})
