import { readFile, access } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import postcss from 'postcss'

const root = fileURLToPath(new URL('..', import.meta.url))
const read = (path) => readFile(join(root, path), 'utf8')

const layoutSource = await read('app/layout.js')
const styleImports = [...layoutSource.matchAll(/import\s+['"]\.\/([^'"]+\.css)['"]/g)].map((match) => `app/${match[1]}`)

if (!styleImports.length) throw new Error('No global stylesheet imports were found in app/layout.js.')

for (const path of styleImports) {
  try {
    await access(join(root, path))
  } catch {
    throw new Error(`Global stylesheet import is missing: ${path}`)
  }
}

const geometryProperties = new Set([
  'position', 'inset', 'inset-block', 'inset-block-start', 'inset-block-end', 'inset-inline',
  'inset-inline-start', 'inset-inline-end', 'top', 'right', 'bottom', 'left',
  'width', 'min-width', 'max-width', 'height', 'min-height', 'max-height',
  'margin', 'margin-block', 'margin-block-start', 'margin-block-end', 'margin-inline',
  'margin-inline-start', 'margin-inline-end', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'padding', 'padding-block', 'padding-block-start', 'padding-block-end', 'padding-inline',
  'padding-inline-start', 'padding-inline-end', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'display', 'grid', 'grid-template', 'grid-template-columns', 'grid-template-rows', 'grid-auto-flow',
  'grid-auto-columns', 'grid-auto-rows', 'grid-column', 'grid-row', 'flex', 'flex-basis', 'flex-direction',
  'flex-wrap', 'gap', 'row-gap', 'column-gap', 'align-items', 'align-content', 'align-self',
  'justify-items', 'justify-content', 'justify-self', 'transform', 'z-index'
])

const shellSelectors = [
  'figma-dashboard-shell', 'figma-dashboard-sidebar', 'figma-dashboard-sidebar-logo', 'figma-dashboard-nav',
  'figma-dashboard-nav-item', 'figma-dashboard-nav-icon', 'figma-dashboard-settings-link', 'figma-dashboard-stage',
  'figma-dashboard-main', 'figma-dashboard-account-menu', 'figma-dashboard-mobile-nav'
]
const pageSelectors = [
  'figma-swipe-screen', 'figma-swipe-workspace', 'figma-swipe-card-stage', 'figma-swipe-actions',
  'figma-swipe-status', 'figma-swipe-empty', 'figma-swipe-filter-trigger',
  'figma-profile-screen', 'figma-profile-hero', 'figma-profile-cards', 'figma-profile-card-column',
  'figma-friends-screen', 'figma-friends-tabs', 'figma-friends-message-layout', 'figma-friends-shared-view',
  'figma-friends-shared-grid', 'figma-friends-add-view', 'figma-friends-search', 'figma-friends-search-results',
  'figma-friends-request-card',
  'figma-pass-screen', 'figma-pass-tabs', 'figma-pass-heading', 'figma-pass-plan-grid', 'figma-pass-notice',
  'figma-pass-manage-screen', 'figma-pass-current-plan', 'figma-pass-manage-actions', 'figma-pass-history',
  'figma-create-post-screen', 'figma-create-post-topbar', 'figma-create-post-workspace', 'figma-create-post-blur',
  'figma-create-post-card', 'figma-create-post-empty',
  'figma-settings-screen', 'figma-settings-window', 'figma-settings-local-nav', 'figma-settings-detail',
  'figma-settings-section'
]

const canonicalFlow = 'app/figma-dashboard-flow.css'
const canonicalSwipe = 'app/figma-visual-parity.css'
const swipeGeometrySelectors = new Set([
  'figma-swipe-screen', 'figma-swipe-workspace', 'figma-swipe-card-stage', 'figma-swipe-actions',
  'figma-swipe-status', 'figma-swipe-empty', 'figma-swipe-filter-trigger'
])
const settingsModeSheets = new Set([
  'app/desktop-settings-reference-20260823.css',
  'app/mobile-settings-post-polish-20260823.css'
])

const normalizeSelector = (selector) => selector.replace(/\s+/g, ' ').trim()
const selectorParts = (selector) => {
  const parts = []
  let start = 0
  let parentheses = 0
  let brackets = 0
  for (let index = 0; index < selector.length; index += 1) {
    const character = selector[index]
    if (character === '(') parentheses += 1
    else if (character === ')') parentheses = Math.max(0, parentheses - 1)
    else if (character === '[') brackets += 1
    else if (character === ']') brackets = Math.max(0, brackets - 1)
    else if (character === ',' && parentheses === 0 && brackets === 0) {
      parts.push(selector.slice(start, index))
      start = index + 1
    }
  }
  parts.push(selector.slice(start))
  return parts.map((part) => normalizeSelector(part)).filter(Boolean)
}
const isPageRootSelector = (selector) => {
  const normalized = normalizeSelector(selector)
  if (/[>+~\s]/.test(normalized)) return false
  return [...shellSelectors, ...pageSelectors].some((name) => new RegExp(`(?:^|[.#])${name}(?=$|[.:#\\[])`).test(normalized))
}
const isSettingsRootSelector = (selector) => normalizeSelector(selector).includes('.figma-settings-')
const isAuthenticatedContractSelector = (selector) => /(?:\.figma-|\.puddle-|\[data-testid=)/.test(normalizeSelector(selector))
const ownerFor = (selector) => {
  const normalized = normalizeSelector(selector)
  return [...swipeGeometrySelectors].some((name) => new RegExp(`(?:^|[.#])${name}(?=$|[.:#\\[])`).test(normalized))
    ? canonicalSwipe
    : canonicalFlow
}

const exactDeclarations = new Map()
const structuralOwners = []
const emptyRules = []

function walk(node, path, context = []) {
  node.each((child) => {
    if (child.type === 'atrule') {
      const meaningfulChildren = (child.nodes || []).filter((nested) => nested.type !== 'comment')
      if (child.nodes && meaningfulChildren.length === 0 && !['import', 'charset', 'namespace', 'layer', 'property'].includes(child.name)) {
        emptyRules.push(`${path}:${child.source?.start?.line || '?'} @${child.name} ${child.params}`.trim())
      }
      walk(child, path, [...context, `@${child.name} ${child.params}`.trim()])
      return
    }
    if (child.type !== 'rule') return

    const meaningfulChildren = (child.nodes || []).filter((nested) => nested.type !== 'comment')
    if (meaningfulChildren.length === 0) {
      emptyRules.push(`${path}:${child.source?.start?.line || '?'} ${child.selector}`)
    }

    const selectors = selectorParts(child.selector)
    for (const declaration of child.nodes || []) {
      if (declaration.type !== 'decl') continue
      const property = declaration.prop.toLowerCase()
      const contextKey = context.join(' > ')
      for (const selector of selectors) {
        const selectorKey = normalizeSelector(selector)
        const exactKey = `${contextKey}\u0000${selectorKey}\u0000${property}`
        const previous = exactDeclarations.get(exactKey) || []
        previous.push({ path, selector: selectorKey, property, context: contextKey, value: declaration.value, important: declaration.important })
        exactDeclarations.set(exactKey, previous)

        if (!isPageRootSelector(selector)) continue
        const isSettings = isSettingsRootSelector(selector)
        const owner = ownerFor(selector)
        const allowed = path === owner || (isSettings && settingsModeSheets.has(path))
        if (!allowed && geometryProperties.has(property)) {
          structuralOwners.push({ path, selector: selectorKey, property, context: contextKey })
        }
      }
    }
    walk(child, path, context)
  })
}

for (const path of styleImports) {
  const source = await read(path)
  const rootNode = postcss.parse(source, { from: join(root, path) })
  walk(rootNode, path)
}

const duplicateDeclarations = [...exactDeclarations.values()].filter((entries) => entries.length > 1 && isPageRootSelector(entries[0].selector) && geometryProperties.has(entries[0].property))
if (duplicateDeclarations.length) {
  const details = duplicateDeclarations.slice(0, 100).map((entries) => {
    const first = entries[0]
    return `${first.selector} { ${first.property} }${first.context ? ` in ${first.context}` : ''}: ${entries.map((entry) => `${entry.path}=${entry.value}${entry.important ? ' !important' : ''}`).join(' | ')}`
  })
  throw new Error(`Duplicate selector/property declarations remain (${duplicateDeclarations.length}).\n${details.join('\n')}`)
}

if (structuralOwners.length) {
  const details = structuralOwners.slice(0, 240).map((entry) => `${entry.path}: ${entry.selector} { ${entry.property} }${entry.context ? ` in ${entry.context}` : ''}`)
  throw new Error(`Page-level geometry escaped its canonical owner (${structuralOwners.length}).\n${details.join('\n')}`)
}

if (emptyRules.length) {
  throw new Error(`Empty CSS rules remain (${emptyRules.length}).\n${emptyRules.slice(0, 100).join('\n')}`)
}

const importedRelative = new Set(styleImports.map((path) => relative(join(root, 'app'), join(root, path)).replaceAll('\\', '/')))
if (importedRelative.size !== styleImports.length) throw new Error('app/layout.js imports a global stylesheet more than once.')

console.log(`Style ownership check passed: ${styleImports.length} global sheets, ${exactDeclarations.size} unique selector/property declarations, canonical page geometry owners in ${canonicalFlow} and ${canonicalSwipe}.`)
