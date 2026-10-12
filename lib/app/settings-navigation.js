import { safeNextPath } from '../auth/redirect.js'

const returnPaths = new Set(['/discover', '/map', '/plans', '/matches', '/membership', '/profile'])

export function settingsReturnPath(value) {
  const path = safeNextPath(value, '/profile')
  return returnPaths.has(path.split(/[?#]/)[0]) ? path : '/profile'
}

export function settingsHref(section, returnTo, { embedded = false, mobile = false } = {}) {
  const params = new URLSearchParams()
  if (embedded) params.set('embedded', '1')
  if (mobile) params.set('mobile', '1')
  if (section) params.set('section', section)
  params.set('returnTo', settingsReturnPath(returnTo))
  return `/account?${params}`
}

// Preserve the existing Settings presentation after a form action, never an
// arbitrary client-supplied redirect or a client-supplied section.
export function settingsActionDestination(formData, section) {
  const path = safeNextPath(formData?.get('settings_return'), '/account')
  const url = new URL(path, 'https://puddle.internal')
  const context = url.pathname === '/account' ? url.searchParams : new URLSearchParams()
  return settingsHref(section, context.get('returnTo'), {
    embedded: context.get('embedded') === '1',
    mobile: context.get('mobile') === '1'
  })
}
