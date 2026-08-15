import { expect } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'

const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
const mailpitUrl = process.env.MAILPIT_URL

export const PASSWORD = 'PuddlePass123!'

function required(value, name) {
  if (!value) throw new Error(`${name} is required for E2E tests.`)
  return value
}

export function adminClient() {
  return createClient(required(supabaseUrl, 'NEXT_PUBLIC_SUPABASE_URL'), required(serviceRoleKey, 'SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false }
  })
}

export function publicClient() {
  return createClient(required(supabaseUrl, 'NEXT_PUBLIC_SUPABASE_URL'), required(anonKey, 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false }
  })
}

export function uniqueEmail(prefix = 'user') {
  return `${prefix}-${Date.now()}-${randomUUID().slice(0, 12)}@example.com`
}

export async function createConfirmedUser({ email = uniqueEmail(), password = PASSWORD, profile = {}, metadata = {} } = {}) {
  const admin = adminClient()
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: metadata
  })
  if (error) throw error

  const userId = data.user?.id
  if (!userId) throw new Error('Supabase did not return a created user id.')

  const profileDefaults = {
    id: userId,
    email,
    username: `user_${userId.replaceAll('-', '').slice(0, 12)}`,
    display_name: profile.display_name || 'E2E User',
    onboarding_completed: profile.onboarding_completed ?? true,
    onboarding_completed_at: profile.onboarding_completed === false ? null : new Date().toISOString(),
    ...profile
  }

  const { error: profileError } = await admin.from('profiles').upsert(profileDefaults)
  if (profileError) throw profileError

  return { id: userId, email, password, profile: profileDefaults }
}

export async function deleteUser(userId) {
  if (!userId) return
  const admin = adminClient()
  await admin.auth.admin.deleteUser(userId)
}

export async function seedPlaces() {
  const admin = adminClient()
  const rows = [
    {
      name: 'Moonlight Cafe',
      description: 'Late-night coffee, soft lights, and downtown people-watching.',
      address: '55 Front St W, Toronto, ON',
      latitude: 43.6455,
      longitude: -79.3807,
      primary_category: 'Cafe',
      categories: ['Cafe', 'Coffee'],
      city: 'Toronto',
      country: 'Canada',
      source: 'e2e'
    },
    {
      name: 'Harbour Walk',
      description: 'Waterfront walking route with skyline views.',
      address: '235 Queens Quay W, Toronto, ON',
      latitude: 43.6387,
      longitude: -79.3816,
      primary_category: 'Park',
      categories: ['Park', 'Outdoors'],
      city: 'Toronto',
      country: 'Canada',
      source: 'e2e'
    },
    {
      name: 'Neon Arcade',
      description: 'Retro cabinets, bright lights, and casual groups.',
      address: '300 King St W, Toronto, ON',
      latitude: 43.6466,
      longitude: -79.3895,
      primary_category: 'Entertainment',
      categories: ['Entertainment', 'Arcade'],
      city: 'Toronto',
      country: 'Canada',
      source: 'e2e'
    }
  ]

  const { data, error } = await admin
    .from('locations')
    .upsert(rows, { onConflict: 'name,address' })
    .select('id,name,primary_category,categories,latitude,longitude')
  if (error) throw error
  return data
}

export async function clearMailpit() {
  if (!mailpitUrl) return
  await fetch(`${mailpitUrl}/api/v1/messages`, { method: 'DELETE' }).catch(() => undefined)
}

export async function waitForEmailLink(email, expectedType = 'signup') {
  required(mailpitUrl, 'MAILPIT_URL')
  let link = null
  await expect.poll(async () => {
    const response = await fetch(`${mailpitUrl}/api/v1/messages`)
    const payload = await response.json()
    const messages = payload.messages || []
    const matching = messages.find((message) => (message.To || []).some((to) => to.Address === email))
    if (!matching) return null

    const detailResponse = await fetch(`${mailpitUrl}/api/v1/message/${matching.ID}`)
    const detail = await detailResponse.json()
    const text = `${detail.Text || ''}\n${detail.HTML || ''}`
    const links = [...text.matchAll(/https?:\/\/[^\s"'<>]+/g)].map((match) => match[0].replaceAll('&amp;', '&'))
    link = links.find((candidate) => {
      try {
        const url = new URL(candidate)
        const type = url.searchParams.get('type')
        return url.pathname.includes('/auth/v1/verify') && (type === expectedType || (expectedType === 'signup' && type === 'email'))
      } catch {
        return false
      }
    }) || null
    return link
  }, { timeout: 20_000, message: `No ${expectedType} email link arrived for ${email}.` }).not.toBeNull()
  return link
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
  const menu = page.locator('details.profile-menu')
  const button = menu.getByRole('button', { name: 'Sign out', exact: true })
  if (!await button.isVisible().catch(() => false)) {
    const summary = menu.locator('> summary')
    await expect(summary).toBeVisible()
    await summary.click()
  }
  await expect(button).toBeVisible()
  await button.click()
  await expect(page).toHaveURL(/\/$/)
}

export async function assertNoHorizontalOverflow(page) {
  const dimensions = await page.evaluate(() => ({ width: window.innerWidth, scrollWidth: document.documentElement.scrollWidth }))
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.width + 1)
}
