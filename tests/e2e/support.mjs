import { randomUUID } from 'node:crypto'
import { expect } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const mailpitUrl = process.env.MAILPIT_URL?.replace(/\/$/, '') || null

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error('E2E requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.')
}

export const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false }
})

export function uniqueSuffix(length = 12) {
  return randomUUID().replaceAll('-', '').slice(0, length)
}

export function uniqueEmail(prefix = 'puddle-e2e') {
  return `${prefix}-${Date.now()}-${uniqueSuffix(12)}@example.com`
}

export async function createConfirmedUser({ displayName = 'E2E Person', password = `Puddle-${uniqueSuffix(18)}-Aa1!` } = {}) {
  const email = uniqueEmail('puddle-e2e')
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: displayName }
  })
  if (error) throw error
  return { email, password, user: data.user }
}

export async function findUserByEmail(email) {
  const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
  if (error) throw error
  const user = data.users.find((candidate) => candidate.email === email)
  if (!user) throw new Error(`Could not find auth user for ${email}`)
  return user
}

export async function waitForProfile(userId) {
  return expect.poll(async () => {
    const { data } = await admin.from('profiles').select('*').eq('id', userId).maybeSingle()
    return data
  }, { timeout: 12_000 }).not.toBeNull().then(async () => {
    const { data, error } = await admin.from('profiles').select('*').eq('id', userId).single()
    if (error) throw error
    return data
  })
}

export async function completeProfileDirect(userId, overrides = {}) {
  const username = overrides.username || `e2e_${uniqueSuffix(10)}`
  const now = new Date().toISOString()
  const payload = {
    id: userId,
    display_name: overrides.display_name || overrides.displayName || 'E2E Person',
    username,
    bio: overrides.bio || 'E2E profile',
    birth_date: overrides.birth_date || '1994-06-15',
    city: overrides.city || 'Toronto',
    region: overrides.region || 'Ontario',
    country: overrides.country || 'Canada',
    country_code: overrides.country_code || 'CA',
    latitude: overrides.latitude ?? 43.6532,
    longitude: overrides.longitude ?? -79.3832,
    timezone: overrides.timezone || 'America/Toronto',
    search_radius_km: overrides.search_radius_km ?? 25,
    interests: overrides.interests || ['cafe', 'restaurant', 'gallery'],
    profile_visibility: overrides.profile_visibility || 'public',
    onboarding_completed_at: overrides.onboarding_completed_at || now,
    updated_at: now
  }
  const { error } = await admin.from('profiles').upsert(payload)
  if (error) throw error
  return payload
}

export async function deleteProfile(userId) {
  const { error } = await admin.from('profiles').delete().eq('id', userId)
  if (error) throw error
}

function authVerificationLink(message, expectedType) {
  const source = `${message?.Text || ''}\n${message?.HTML || ''}`.replaceAll('&amp;', '&')
  const links = source.match(/https?:\/\/[^\s"'<>]+/g) || []
  for (const raw of links) {
    try {
      const url = new URL(raw.replace(/[),.;]+$/, ''))
      if (!url.pathname.includes('/auth/v1/verify')) continue
      const type = url.searchParams.get('type')
      if (type === expectedType || (expectedType === 'signup' && type === 'email')) return url.toString()
    } catch {
      // Ignore non-URL fragments in rendered email bodies.
    }
  }
  return null
}

async function findAuthEmailLink(email, expectedType) {
  if (!mailpitUrl) throw new Error('E2E requires MAILPIT_URL to inspect Supabase auth emails.')
  const response = await fetch(`${mailpitUrl}/api/v1/messages?limit=100`)
  if (!response.ok) throw new Error(`Mailpit message list failed with ${response.status}.`)
  const mailbox = await response.json()
  const target = email.toLowerCase()
  const summaries = (mailbox.messages || []).filter((message) => (message.To || []).some((recipient) => String(recipient.Address || '').toLowerCase() === target))

  for (const summary of summaries) {
    if (!summary.ID) continue
    const detailResponse = await fetch(`${mailpitUrl}/api/v1/message/${encodeURIComponent(summary.ID)}`)
    if (!detailResponse.ok) continue
    const link = authVerificationLink(await detailResponse.json(), expectedType)
    if (link) return link
  }
  return null
}

export async function waitForAuthEmailLink(email, expectedType) {
  let found = await findAuthEmailLink(email, expectedType)
  if (found) return found

  await expect.poll(async () => {
    found = await findAuthEmailLink(email, expectedType)
    return found
  }, { timeout: 20_000, message: `No ${expectedType} email link arrived for ${email}.` }).not.toBeNull()

  return found
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
  // The current Figma composition intentionally hides the legacy three-dot
  // account menu. Keep auth coverage on the real production sign-out server
  // action by submitting its rendered form instead of inventing a visible
  // control solely for E2E.
  await page.goto('/discover')
  const button = page.locator('details.figma-dashboard-account-menu').getByRole('button', { name: 'Sign out', exact: true })
  await expect(button).toHaveCount(1)
  await button.evaluate((element) => element.form?.requestSubmit(element))
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
