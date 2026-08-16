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

test('Saved Place Open follows the authored Figma 38:223 composition', async () => {
  const [page, styles, layout] = await Promise.all([
    read('app/plans/[slug]/page.js'),
    read('app/figma-dashboard-saved-detail-fidelity.css'),
    read('app/layout.js')
  ])

  assert.match(page, /data-figma-node="38:223"/)
  assert.match(page, /figma-saved-detail-categories/)
  assert.match(page, />All<\/Link>/)
  assert.match(page, />Courts<\/Link>/)
  assert.match(page, />Theatres<\/Link>/)
  assert.match(page, /figma-saved-detail-actions/)
  assert.match(page, /figma-saved-detail-title/)
  assert.match(page, /Price varies/)
  assert.match(page, /Local spot/)
  assert.match(page, /figma-saved-detail-reviews/)
  assert.match(page, /figma-saved-detail-map/)
  assert.doesNotMatch(page, /figma-saved-detail-kicker/)
  assert.doesNotMatch(page, /figma-saved-detail-description/)
  assert.doesNotMatch(page, /figma-saved-detail-tags/)

  assert.match(styles, /\.figma-saved-detail-card\s*\{[^}]*top:\s*173px;[^}]*left:\s*16px;[^}]*width:\s*962px;[^}]*height:\s*970px;/s)
  assert.match(styles, /\.figma-saved-detail-media\s*\{[^}]*top:\s*20\.5px;[^}]*left:\s*15\.5px;[^}]*width:\s*529px;[^}]*height:\s*263px;/s)
  assert.match(styles, /\.figma-saved-detail-title\s*\{[^}]*top:\s*322\.48px;[^}]*left:\s*22\.43px;[^}]*width:\s*546\.186px;[^}]*font:\s*800 64px\/1 Manrope/s)
  assert.match(styles, /\.figma-saved-detail-reviews\s*\{[^}]*top:\s*611\.5px;[^}]*left:\s*21\.5px;[^}]*width:\s*533px;[^}]*height:\s*332px;/s)
  assert.match(styles, /\.figma-saved-detail-map\s*\{[^}]*top:\s*21\.5px;[^}]*left:\s*564\.5px;[^}]*width:\s*370px;[^}]*height:\s*583px;/s)
  assert.match(styles, /grid-template-columns:\s*repeat\(3, 308\.435px\)/)
  assert.match(styles, /\.figma-saved-floating-search\.figma-saved-detail-search\s*\{[^}]*position:\s*absolute;[^}]*top:\s*1478px;[^}]*left:\s*273px;/s)

  const functionalIndex = layout.indexOf("import './functional-completion.css'")
  const fidelityIndex = layout.indexOf("import './figma-dashboard-saved-detail-fidelity.css'")
  assert.ok(functionalIndex >= 0 && fidelityIndex > functionalIndex, 'Saved detail fidelity must load after functional overrides')
})
