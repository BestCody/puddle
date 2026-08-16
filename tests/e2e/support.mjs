import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { expect } from '@playwright/test'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const mailpitUrl = process.env.MAILPIT_URL || 'http://127.0.0.1:54324'

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error('E2E tests require NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.')
}

export const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false }
})

export function uniqueSuffix(length = 12) {
  return randomUUID().replaceAll('-', '').slice(0, length)
}

export function uniqueEmail(label = 'user') {
  return `${label}-${Date.now()}-${uniqueSuffix()}@example.com`
}

export async function poll(fn, { timeout = 15_000, interval = 250, message = 'Condition was not met.' } = {}) {
  const started = Date.now()
  let lastError
  while (Date.now() - started < timeout) {
    try {
      const result = await fn()
      if (result) return result
    } catch (error) {
      lastError = error
    }
    await new Promise((resolve) => setTimeout(resolve, interval))
  }
  throw lastError || new Error(message)
}

export async function findUserByEmail(email) {
  return poll(async () => {
    const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
    if (error) throw error
    return data.users.find((user) => user.email?.toLowerCase() === email.toLowerCase()) || null
  }, { message: `Auth user ${email} was not created.` })
}

export async function waitForProfile(userId) {
  return poll(async () => {
    const { data, error } = await admin.from('profiles').select('*').eq('id', userId).maybeSingle()
    if (error) throw error
    return data || null
  }, { message: `Profile ${userId} was not created.` })
}

export async function createConfirmedUser({ email = uniqueEmail(), password = 'PuddlePass123!', displayName = 'E2E Puddle Person' } = {}) {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: displayName }
  })
  if (error) throw error
  await waitForProfile(data.user.id)
  return { user: data.user, email, password, displayName }
}

export async function completeProfileDirect(userId, overrides = {}) {
  const payload = {
    id: userId,
    display_name: 'Ready Tester',
    username: `ready_${uniqueSuffix(10)}`,
    birth_date: '1995-05-15',
    city: 'Toronto',
    region: 'Ontario',
    country: 'Canada',
    country_code: 'CA',
    latitude: 43.6532,
    longitude: -79.3832,
    timezone: 'America/Toronto',
    location_label: 'Toronto, Ontario, Canada',
    location_source: 'admin',
    location_updated_at: new Date().toISOString(),
    search_radius_km: 10,
    bio: 'Prepared for browser tests.',
    profile_visibility: 'friends',
    interests: ['cafe', 'restaurant', 'gallery'],
    onboarding_completed_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides
  }
  const { data, error } = await admin.from('profiles').upsert(payload, { onConflict: 'id' }).select('*').single()
  if (error) throw error
  return data
}

export async function deleteProfile(userId) {
  const { error } = await admin.from('profiles').delete().eq('id', userId)
  if (error) throw error
}

const htmlEntities = new Map([
  ['&amp;', '&'],
  ['&#x2f;', '/'],
  ['&#47;', '/'],
  ['&quot;', '"']
])

function decodeHtml(value) {
  return String(value || '').replace(/&(?:amp|#x2f|#47|quot);/gi, (entity) => htmlEntities.get(entity.toLowerCase()) || entity)
}

function linksFromMessage(html) {
  const links = []
  for (const match of html.matchAll(/href\s*=\s*(?:"([^"]+)"|'([^']+)')/gi)) {
    links.push(decodeHtml(match[1] || match[2]))
  }
  for (const match of html.matchAll(/https?:\/\/[^\s"'<>]+/gi)) links.push(decodeHtml(match[0]))
  return [...new Set(links)]
}

export async function waitForAuthEmailLink(email, expectedType) {
  const query = encodeURIComponent(`to:${email}`)
  return poll(async () => {
    const response = await fetch(`${mailpitUrl}/view/latest.html?query=${query}`)
    if (response.status === 404) return null
    if (!response.ok) throw new Error(`Mailpit returned ${response.status}.`)
    const links = linksFromMessage(await response.text())
    return links.find((link) => {
      try {
        const url = new URL(link)
        const type = url.searchParams.get('type')
        return url.pathname.includes('/auth/v1/verify') && (type === expectedType || (expectedType === 'signup' && type === 'email'))
      } catch {
        return false
      }
    }) || null
  }, { timeout: 20_000, message: `No ${expectedType} email link arrived for ${email}.` })
}

export function directConfirmationPath(verificationLink, next = '/onboarding') {
  const url = new URL(verificationLink)
  const tokenHash = url.searchParams.get('token')
  const type = url.searchParams.get('type') || 'signup'
  if (!tokenHash) throw new Error('Confirmation email did not contain a token hash.')
  const params = new URLSearchParams({ token_hash: tokenHash, type, next })
  return `/auth/confirm?${params}`
}

export async function attemptSignInThroughUi(page, email, password, next = '/discover') {
  await page.goto(`/signin?next=${encodeURIComponent(next)}`)
  await page.getByLabel('Email').first().fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
}

export async function signInThroughUi(page, email, password, next = '/discover') {
  await attemptSignInThroughUi(page, email, password, next)
  await expect(page).not.toHaveURL(/\/signin(?:\?|$)/)
}

export async function signOutThroughUi(page) {
  let menu = page.locator('details.profile-menu')
  let summary = menu.locator('> summary')

  // The current desktop Figma intentionally shows the profile menu only on
  // Swipe. Functional auth tests may arrive on Settings/Profile first, so use
  // the real visible menu route instead of requiring a non-Figma header there.
  if (!await summary.isVisible().catch(() => false)) {
    await page.goto('/discover')
    menu = page.locator('details.profile-menu')
    summary = menu.locator('> summary')
  }

  const button = menu.getByRole('button', { name: 'Sign out', exact: true })
  if (!await button.isVisible().catch(() => false)) {
    await expect(summary).toBeVisible()
    await summary.click()
  }
  await expect(button).toBeVisible()
  await button.click()
  await expect(page).toHaveURL(/\/$/)
}

export async function assertNoHorizontalOverflow(page) {
  const dimensions = await page.evaluate(() => {
    const width = window.innerWidth
    const scrollWidth = document.documentElement.scrollWidth
    const offenders = scrollWidth > width + 1
      ? [...document.querySelectorAll('body *')].map((element) => {
          const rect = element.getBoundingClientRect()
          return {
            tag: element.tagName.toLowerCase(),
            className: typeof element.className === 'string' ? element.className.slice(0, 160) : '',
            right: Math.round(rect.right * 10) / 10,
            left: Math.round(rect.left * 10) / 10,
            width: Math.round(rect.width * 10) / 10
          }
        }).filter((item) => item.width > 0 && item.right > width + 1)
          .sort((a, b) => b.right - a.right)
          .slice(0, 12)
      : []
    return { width, scrollWidth, offenders }
  })
  expect(
    dimensions.scrollWidth,
    `Horizontal overflow offenders: ${JSON.stringify(dimensions.offenders)}`
  ).toBeLessThanOrEqual(dimensions.width + 1)
}