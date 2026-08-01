const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on'])

export const ACTIVE_PRODUCT_SURFACES = Object.freeze([
  'location discovery',
  'saved, planned, and past locations',
  'DateMatch and shared location choice',
  'location contributions and claims',
  'recommendation preferences',
  'profiles, reports, moderation, and security'
])

export const LEGACY_PRODUCT_SURFACES = Object.freeze([
  'event marketplace',
  'creator and event studio',
  'ticketing, checkout, payouts, refunds, and check-in',
  'general friend graph and direct-message inbox',
  'temporary live-location sharing',
  'complex collaborative itineraries',
  'host-following and creator marketing',
  'event-writing and social-caption assistance'
])

export function legacySystemsEnabled(env = process.env) {
  return TRUE_VALUES.has(String(env.PUDDLE_LEGACY_SYSTEMS_ENABLED || '').trim().toLowerCase())
}

function matchesPrefix(pathname, prefix) {
  return pathname === prefix || pathname.startsWith(`${prefix}/`)
}

const LEGACY_PAGE_REDIRECTS = Object.freeze([
  { exact: '/create', destination: '/create/place' },
  { prefix: '/create/event', destination: '/create/place' },
  { prefix: '/explore', destination: '/discover' },
  { prefix: '/events', destination: '/discover' },
  { prefix: '/studio', destination: '/discover' },
  { prefix: '/hosts', destination: '/discover' },
  { prefix: '/friends', destination: '/discover' },
  { prefix: '/inbox', destination: '/discover' },
  { prefix: '/wallet', destination: '/plans' },
  { prefix: '/orders', destination: '/plans' },
  { prefix: '/settings/payouts', destination: '/profile' }
])

const LEGACY_API_PREFIXES = Object.freeze([
  '/api/stripe',
  '/api/tickets',
  '/api/check-in',
  '/api/location-sharing',
  '/api/studio',
  '/api/events',
  '/api/hosts',
  '/api/friends',
  '/api/conversations',
  '/api/messages',
  '/api/plans',
  '/api/ai/assist',
  '/api/ai/decision'
])

export function legacyRedirectForPath(pathname) {
  if (pathname.startsWith('/plans/')) return '/plans'
  for (const rule of LEGACY_PAGE_REDIRECTS) {
    if (rule.exact && pathname === rule.exact) return rule.destination
    if (rule.prefix && matchesPrefix(pathname, rule.prefix)) return rule.destination
  }
  return null
}

export function isLegacyApiPath(pathname) {
  return LEGACY_API_PREFIXES.some((prefix) => matchesPrefix(pathname, prefix))
}
