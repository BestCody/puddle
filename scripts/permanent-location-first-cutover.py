from __future__ import annotations

import json
import re
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def path(value: str) -> Path:
    return ROOT / value


def write(value: str, content: str) -> None:
    target = path(value)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content.rstrip() + "\n", encoding="utf-8")


def remove(value: str) -> None:
    target = path(value)
    if target.is_dir():
        shutil.rmtree(target)
    elif target.exists():
        target.unlink()


def replace(value: str, old: str, new: str) -> None:
    target = path(value)
    content = target.read_text(encoding="utf-8")
    if old not in content:
        raise RuntimeError(f"Expected marker missing from {value}: {old[:100]}")
    target.write_text(content.replace(old, new), encoding="utf-8")


# Remove executable legacy product surfaces. Historical SQL migrations remain immutable.
for value in [
    "app/admin/finance",
    "app/api/ai/assist",
    "app/api/ai/decision",
    "app/api/check-in",
    "app/api/conversations",
    "app/api/discovery/action",
    "app/api/location-sharing",
    "app/api/maps",
    "app/api/stripe",
    "app/api/studio/events",
    "app/api/tickets",
    "app/create/event",
    "app/events",
    "app/explore",
    "app/friends",
    "app/hosts",
    "app/inbox",
    "app/orders",
    "app/plans/[id]",
    "app/plans/legacy-page.js",
    "app/settings/payouts",
    "app/social/actions.js",
    "app/studio/events",
    "app/studio/hosts",
    "app/wallet",
    "components/ai-creation-assistant.js",
    "components/attendee-manager.js",
    "components/check-in-scanner.js",
    "components/date-swipe-workspace.js",
    "components/discovery-deck.js",
    "components/discovery-workspace.js",
    "components/event-editor.js",
    "components/listing-social.js",
    "components/order-status.js",
    "components/payout-onboarding.js",
    "components/realtime-conversation.js",
    "components/temporary-location-sharing.js",
    "components/ticket-finance-console.js",
    "components/ticket-purchase-panel.js",
    "components/ticket-wallet.js",
    "lib/app/discovery.js",
    "lib/app/plans-data.js",
    "lib/app/social-data.js",
    "lib/app/stage-one-data.js",
    "lib/app/ticketing-data.js",
    "lib/product-vision.js",
    "lib/stripe",
    "lib/tickets",
    "public/events",
    "scripts/check-product-vision.mjs",
    "scripts/check-stage-five.mjs",
    "scripts/expire-location-sharing.mjs",
    "scripts/expire-ticket-reservations.mjs",
    "scripts/generate-ticket-keys.mjs",
    "scripts/process-stripe-webhooks.mjs",
    "scripts/reconcile-stripe.mjs",
    "scripts/stripe-test-mode-integration.mjs",
    "scripts/test-stage-five.mjs",
    "tests/unit/product-vision.test.mjs",
    "docs/LOCATION_FIRST_CUTOVER.md",
    "docs/STAGE_5_SETUP.md",
    "app/stage-five.css",
    "app/stage-six.css",
    "supabase/migrations/10029_r2_cleanup_batch_preview.sql",
]:
    remove(value)

write("lib/app/discovery-filters.js", r'''
const KIND_OPTIONS = new Set(['place'])
const PRICE_OPTIONS = new Set(['any', '1', '2', '3', '4'])

function text(value, max = 120) {
  return String(value || '').trim().slice(0, max)
}

function number(value, fallback = null) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function boolean(value) {
  return value === true || value === 'true' || value === '1' || value === 'on'
}

export function parseDiscoveryFilters(source = {}, defaultDistance = 25) {
  const requestedDistance = number(source.distance, number(defaultDistance, 25))
  return {
    q: text(source.q, 100).toLowerCase(),
    kind: KIND_OPTIONS.has(source.kind) ? source.kind : 'place',
    category: text(source.category, 60),
    date: 'any',
    distance: Math.max(1, Math.min(100, requestedDistance || 25)),
    price: PRICE_OPTIONS.has(String(source.price)) ? String(source.price) : 'any',
    openNow: boolean(source.open_now ?? source.openNow),
    accessible: boolean(source.accessible),
    amenity: text(source.amenity, 60).toLowerCase(),
    latitude: number(source.latitude, null),
    longitude: number(source.longitude, null),
    limit: Math.min(100, Math.max(1, number(source.limit, 40)))
  }
}

function parseClock(value) {
  const match = String(value || '').trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i)
  if (!match) return null
  let hour = Number(match[1])
  const minute = Number(match[2] || 0)
  const period = match[3]?.toLowerCase()
  if (period === 'pm' && hour < 12) hour += 12
  if (period === 'am' && hour === 12) hour = 0
  if (hour > 23 || minute > 59) return null
  return hour * 60 + minute
}

export function isOpenAt(openingHours, timezone, at = new Date()) {
  if (!openingHours || typeof openingHours !== 'object') return false
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone || 'UTC', weekday: 'long', hour: 'numeric', minute: 'numeric', hour12: false
    })
    const parts = Object.fromEntries(formatter.formatToParts(at).map((part) => [part.type, part.value]))
    const value = String(openingHours[String(parts.weekday || '').toLowerCase()] || '').trim()
    if (!value || /^closed$/i.test(value)) return false
    if (/24\s*hours|open\s*24/i.test(value)) return true
    const [rawStart, rawEnd] = value.replace(/[–—]/g, '-').split('-').map((part) => part.trim())
    const start = parseClock(rawStart)
    const end = parseClock(rawEnd)
    if (start === null || end === null) return true
    const nowMinutes = Number(parts.hour) * 60 + Number(parts.minute)
    return end >= start ? nowMinutes >= start && nowMinutes < end : nowMinutes >= start || nowMinutes < end
  } catch {
    return false
  }
}
''')

write("proxy.js", r'''
import { NextResponse } from 'next/server'
import { updateSession } from '@/lib/supabase/proxy'
import { allowedCorsOrigins, applySecurityHeaders, applicationOrigin, nonceValue } from '@/lib/security/headers'
import { isUnsafeMethod } from '@/lib/security/request'
import { canonicalPuddleAuthUrl } from '@/lib/auth/origin'

const protectedPrefixes = ['/dashboard','/discover','/date-match','/hangout','/matches','/map','/plans','/create','/studio','/report','/profile','/onboarding','/account','/change-email','/settings','/appeals','/admin']
const authOnlyPaths = ['/signin','/signup','/forgot-password']
const staticLandingPaths = new Set(['/','/landing.html','/index.html','/responsive-landing'])
const cacheablePublicPaths = new Set([...staticLandingPaths, '/privacy', '/terms'])
const authCanonicalPaths = new Set(['/signin','/signup','/forgot-password','/verify-email','/update-password','/change-email','/auth/callback','/auth/confirm','/auth/error'])
const publicNoSessionPaths = new Set([...cacheablePublicPaths, '/verify-email', '/auth/callback', '/auth/confirm', '/auth/error'])

function carriesCookies(source, target) {
  for (const cookie of source.cookies.getAll()) target.cookies.set(cookie.name, cookie.value, cookie)
  return target
}
function secured(response, context) { return applySecurityHeaders(response, context) }
function forbidden(request, nonce, message = 'Cross-site request blocked.') { return secured(NextResponse.json({ error: message }, { status: 403 }), { request, nonce }) }
function hasSupabaseAuthCookie(request) { return request.cookies.getAll().some(({ name }) => /^sb-.+-auth-token(?:\.\d+)?$/i.test(name)) }
function cachePolicy(response, pathname, privateResponse = false) {
  if (privateResponse) { response.headers.set('Cache-Control', 'private, no-store'); return response }
  if (cacheablePublicPaths.has(pathname)) {
    response.headers.set('Cache-Control', 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400')
    response.headers.set('CDN-Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400')
  } else response.headers.set('Cache-Control', 'no-store')
  return response
}

export async function proxy(request) {
  const nonce = nonceValue()
  const pathname = request.nextUrl.pathname
  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('x-nonce', nonce)
  requestHeaders.set('x-request-id', request.headers.get('x-request-id') || request.headers.get('cf-ray') || crypto.randomUUID())

  if (request.method === 'OPTIONS' && pathname.startsWith('/api/')) {
    const origin = request.headers.get('origin')
    if (!origin || !allowedCorsOrigins(request).has(origin)) return forbidden(request, nonce, 'Origin is not allowed.')
    const response = new NextResponse(null, { status: 204 })
    response.headers.set('Access-Control-Allow-Origin', origin)
    response.headers.set('Access-Control-Allow-Credentials', 'true')
    response.headers.set('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS')
    response.headers.set('Access-Control-Allow-Headers', 'content-type,x-puddle-device,x-puddle-csrf,x-puddle-action')
    response.headers.set('Access-Control-Max-Age', '600')
    response.headers.set('Vary', 'Origin')
    return secured(response, { request, nonce })
  }

  if (isUnsafeMethod(request.method)) {
    const fetchSite = request.headers.get('sec-fetch-site')
    if (fetchSite === 'cross-site' || fetchSite === 'same-site') return forbidden(request, nonce)
    const origin = request.headers.get('origin')
    if (origin && origin !== applicationOrigin(request)) return forbidden(request, nonce, 'Origin is not allowed.')
  }

  const maxBytes = pathname === '/api/media/upload' ? 20_000_000 : pathname.startsWith('/api/') ? 256_000 : 2_000_000
  const contentLength = Number(request.headers.get('content-length') || 0)
  if (contentLength > maxBytes) return secured(NextResponse.json({ error: 'Request payload is too large.' }, { status: 413 }), { request, nonce })

  const canonicalTarget = (request.method === 'GET' || request.method === 'HEAD') ? canonicalPuddleAuthUrl(request.url, process.env.NEXT_PUBLIC_SITE_URL, authCanonicalPaths) : null
  if (canonicalTarget) return secured(NextResponse.redirect(canonicalTarget, 307), { request, nonce })

  if (publicNoSessionPaths.has(pathname)) {
    const response = NextResponse.next({ request: { headers: requestHeaders } })
    return secured(cachePolicy(response, pathname), { request, nonce, staticScripts: staticLandingPaths.has(pathname) })
  }

  const isProtected = protectedPrefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))
  const isAuthOnly = authOnlyPaths.includes(pathname)
  const hasAuthFailure = request.nextUrl.searchParams.has('error') || request.nextUrl.searchParams.has('auth_error')
  const needsSession = isProtected || (hasSupabaseAuthCookie(request) && !pathname.startsWith('/api/'))

  if (!needsSession) {
    const response = NextResponse.next({ request: { headers: requestHeaders } })
    return secured(cachePolicy(response, pathname, isAuthOnly), { request, nonce })
  }

  const { response, user, configured } = await updateSession(request, requestHeaders)
  if (isProtected && !configured) {
    const url = new URL('/signin', request.url); url.searchParams.set('error', 'Accounts are temporarily unavailable. Please try again later.')
    return secured(cachePolicy(carriesCookies(response, NextResponse.redirect(url)), pathname, true), { request, nonce })
  }
  if (isProtected && !user) {
    const url = new URL('/signin', request.url); url.searchParams.set('next', `${pathname}${request.nextUrl.search}`)
    return secured(cachePolicy(carriesCookies(response, NextResponse.redirect(url)), pathname, true), { request, nonce })
  }
  if (isAuthOnly && user && !hasAuthFailure) return secured(cachePolicy(carriesCookies(response, NextResponse.redirect(new URL('/discover', request.url))), pathname, true), { request, nonce })
  return secured(cachePolicy(response, pathname, Boolean(user) || isProtected || isAuthOnly), { request, nonce })
}

export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\.(?:svg|png|jpg|jpeg|gif|webp|css|js)$).*)'] }
''')

write("app/create/page.js", r'''
import { redirect } from 'next/navigation'

export const metadata = { title: 'Add location' }

export default function CreatePage() {
  redirect('/create/place')
}
''')

write("lib/app/content-input.js", r'''
const visibilities = new Set(['public', 'unlisted', 'private'])
const locationKinds = new Set(['cafe','restaurant','bar','park','museum','gallery','attraction','activity_venue','study_spot','scenic_spot','nightlife','shop','community_space','other'])

function text(value, max = 5000) { return String(value || '').trim().slice(0, max) }
function nullableText(value, max = 5000) { const cleaned = text(value, max); return cleaned || null }
function list(value, maxItems = 24) { return text(value, 2000).split(/[\n,]/).map((item) => item.trim()).filter(Boolean).slice(0, maxItems) }
function boolean(value) { return value === true || value === 'true' || value === 'on' || value === '1' }
function integer(value, { min = 0, max = 1000000, nullable = true } = {}) {
  if (value === '' || value === null || value === undefined) return nullable ? null : min
  const parsed = Number.parseInt(String(value), 10)
  if (!Number.isFinite(parsed)) return nullable ? null : min
  return Math.min(max, Math.max(min, parsed))
}
function decimal(value, { min, max } = {}) {
  if (value === '' || value === null || value === undefined) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : null
}
function slugify(value) { return text(value, 100).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 72) || 'puddle-location' }
function uniqueSlug(value) { return `${slugify(value)}-${crypto.randomUUID().slice(0, 7)}` }
function contactLinks(input) {
  const links = { website: nullableText(input.website, 400), instagram: nullableText(input.instagram, 120), email: nullableText(input.contact_email, 254), phone: nullableText(input.contact_phone, 40) }
  return Object.fromEntries(Object.entries(links).filter(([, value]) => value))
}
function accessibility(input) {
  return {
    wheelchair_accessible: boolean(input.wheelchair_accessible), accessible_washroom: boolean(input.accessible_washroom),
    step_free: boolean(input.step_free), hearing_support: boolean(input.hearing_support), sensory_friendly: boolean(input.sensory_friendly),
    notes: nullableText(input.accessibility_notes, 1200)
  }
}
function openingHours(input) {
  const result = {}
  for (const day of ['monday','tuesday','wednesday','thursday','friday','saturday','sunday']) {
    const hours = nullableText(input[`hours_${day}`], 100)
    if (hours) result[day] = hours
  }
  return result
}

export function locationPayload(input, userId, existing = null) {
  const hostProfileId = nullableText(input.host_profile_id, 64)
  const name = text(input.name || existing?.name || '', 120)
  return {
    created_by: existing?.created_by || userId, host_profile_id: hostProfileId, name,
    slug: existing?.slug || uniqueSlug(name), kind: locationKinds.has(input.kind) ? input.kind : 'other',
    summary: nullableText(input.summary, 500), description: nullableText(input.description, 10000),
    city: text(input.city || existing?.city || '', 120), neighborhood: nullableText(input.neighborhood, 120),
    address_public: nullableText(input.address_public, 500), private_address: nullableText(input.private_address, 500),
    latitude: decimal(input.latitude, { min: -90, max: 90 }), longitude: decimal(input.longitude, { min: -180, max: 180 }),
    timezone: text(input.timezone || existing?.timezone || 'America/Toronto', 80), opening_hours: openingHours(input),
    amenities: list(input.amenities, 30), tags: list(input.tags, 20), accessibility: accessibility(input),
    price_level: integer(input.price_level, { min: 1, max: 4, nullable: true }),
    visibility: visibilities.has(input.visibility) ? input.visibility : 'public', comments_enabled: boolean(input.comments_enabled),
    contact_links: contactLinks(input), autosaved_at: new Date().toISOString()
  }
}

export function validateLocation(payload) {
  const errors = []
  if (payload.name.length < 2) errors.push('Add a location name.')
  if (!payload.city) errors.push('Add the city for this location.')
  if ((payload.latitude === null) !== (payload.longitude === null)) errors.push('Add both latitude and longitude, or leave both blank.')
  if (payload.host_profile_id && !/^[0-9a-f-]{36}$/i.test(payload.host_profile_id)) errors.push('Choose a valid host identity.')
  return errors
}

export function objectFromFormData(formData) { return Object.fromEntries(formData.entries()) }
''')

write("app/create/actions.js", r'''
"use server"

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { requireUser } from '@/lib/auth/user'
import { pathWithMessage, safeNextPath } from '@/lib/auth/redirect'
import { locationPayload, objectFromFormData, validateLocation } from '@/lib/app/content-input'

function firstError(error, fallback) {
  const message = String(error?.message || '').trim()
  return !message || /policy|permission|schema cache|relation|supabase/i.test(message) ? fallback : message
}
function editLocationPath(id) { return id ? `/studio/places/${id}` : '/create/place' }
async function savePrivateDetail(supabase, id, exactAddress, userId) {
  if (exactAddress) return supabase.from('location_private_details').upsert({ location_id: id, exact_address: exactAddress, updated_by: userId, updated_at: new Date().toISOString() })
  return supabase.from('location_private_details').delete().eq('location_id', id)
}
async function persistLocation(formData) {
  const session = await requireUser({ onboarding: true })
  const input = objectFromFormData(formData)
  const id = String(input.id || '').trim()
  let existing = null
  if (id) {
    const { data } = await session.supabase.from('locations').select('*').eq('id', id).maybeSingle()
    existing = data
    if (!existing) redirect(pathWithMessage('/create/place', 'error', 'That location draft is not available.'))
  }
  const payload = locationPayload(input, session.user.id, existing)
  const errors = validateLocation(payload)
  if (errors.length) redirect(pathWithMessage(editLocationPath(id), 'error', errors[0]))
  const privateAddress = payload.private_address
  const writable = { ...payload }
  delete writable.private_address
  if (existing) { delete writable.created_by; delete writable.slug }
  const query = existing
    ? session.supabase.from('locations').update(writable).eq('id', id).select('id,slug,status').single()
    : session.supabase.from('locations').insert(writable).select('id,slug,status').single()
  const { data, error } = await query
  if (error || !data) redirect(pathWithMessage(editLocationPath(id), 'error', firstError(error, 'We could not save this location draft.')))
  const privateResult = await savePrivateDetail(session.supabase, data.id, privateAddress, session.user.id)
  if (privateResult.error) redirect(pathWithMessage(`/studio/places/${data.id}`, 'error', 'The draft saved, but its private address could not be secured.'))
  return { session, location: data }
}

export async function saveLocationDraft(formData) {
  const { location } = await persistLocation(formData)
  revalidatePath('/create')
  redirect(pathWithMessage(`/studio/places/${location.id}`, 'success', 'Location draft saved.'))
}
export async function requestLocationPublication(formData) {
  const { session, location } = await persistLocation(formData)
  const { data, error } = await session.supabase.rpc('request_location_publication', { target: location.id })
  if (error) redirect(pathWithMessage(`/studio/places/${location.id}`, 'error', firstError(error, 'This location is not ready to publish yet.')))
  revalidatePath('/discover')
  revalidatePath(`/places/${location.slug}`)
  redirect(pathWithMessage(`/studio/places/${location.id}`, 'success', data === 'published' ? 'Location published.' : 'Location submitted for review.'))
}
export async function transitionLocationStatus(formData) {
  const session = await requireUser({ onboarding: true })
  const id = String(formData.get('id') || '')
  const nextStatus = String(formData.get('next_status') || '')
  const note = String(formData.get('note') || '').slice(0, 500)
  const { error } = await session.supabase.rpc('transition_location_status', { target: id, next_status: nextStatus, transition_note: note || null })
  if (error) redirect(pathWithMessage(`/studio/places/${id}`, 'error', firstError(error, 'That location status change is not allowed.')))
  revalidatePath(`/studio/places/${id}`)
  redirect(pathWithMessage(`/studio/places/${id}`, 'success', `Location moved to ${nextStatus.replaceAll('_', ' ')}.`))
}
export async function submitLocationClaim(formData) {
  const session = await requireUser({ onboarding: true })
  const locationId = String(formData.get('location_id') || '')
  const hostProfileId = String(formData.get('host_profile_id') || '').trim() || null
  const relationship = String(formData.get('relationship') || '').trim().slice(0, 120)
  const evidenceUrl = String(formData.get('evidence_url') || '').trim().slice(0, 500) || null
  const note = String(formData.get('note') || '').trim().slice(0, 1200) || null
  const next = safeNextPath(String(formData.get('next') || '/discover'))
  if (!locationId || !relationship) redirect(pathWithMessage(next, 'error', 'Describe your relationship to this location.'))
  const { error } = await session.supabase.from('location_claims').insert({ location_id: locationId, claimant_id: session.user.id, host_profile_id: hostProfileId, relationship, evidence_url: evidenceUrl, note })
  if (error) redirect(pathWithMessage(next, 'error', firstError(error, 'We could not submit this claim.')))
  redirect(pathWithMessage(next, 'success', 'Location claim submitted for review.'))
}
''')

write("app/api/drafts/[kind]/route.js", r'''
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isSupabaseConfigured } from '@/lib/supabase/env'
import { locationPayload, validateLocation } from '@/lib/app/content-input'
import { verifyCsrf } from '@/lib/security/csrf'
import { enforceRateLimit } from '@/lib/security/rate-limit'
import { readJsonLimited, safeSecurityError } from '@/lib/security/request'

export const dynamic = 'force-dynamic'

function message(error, fallback) {
  const value = String(error?.message || '').trim()
  return value && !/policy|permission|schema cache|relation|supabase/i.test(value) ? value : fallback
}

async function savePrivateDetail(supabase, id, exactAddress, userId) {
  if (exactAddress) return supabase.from('location_private_details').upsert({ location_id: id, exact_address: exactAddress, updated_by: userId, updated_at: new Date().toISOString() })
  return supabase.from('location_private_details').delete().eq('location_id', id)
}

export async function POST(request, context) {
  if (!verifyCsrf(request)) return NextResponse.json({ error: 'Security token is invalid.' }, { status: 403 })
  if (!isSupabaseConfigured()) return NextResponse.json({ error: 'Draft saving is temporarily unavailable.' }, { status: 503 })
  const { kind } = await context.params
  if (kind !== 'place') return NextResponse.json({ error: 'Unknown draft type.' }, { status: 404 })
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Sign in to save drafts.' }, { status: 401 })
  const limited = await enforceRateLimit({ headers: request.headers, userId: user.id, action: 'draft_autosave' })
  if (!limited.allowed) return NextResponse.json({ error: 'Drafts are being saved too quickly. Pause briefly and try again.' }, { status: 429, headers: { 'retry-after': String(limited.retryAfter || 60) } })
  let input
  try { input = await readJsonLimited(request, 64_000) }
  catch (error) { return NextResponse.json({ error: safeSecurityError(error, 'The draft could not be read.') }, { status: error?.status || 400 }) }
  const id = String(input.id || '').trim()
  let existing = null
  if (id) {
    const result = await supabase.from('locations').select('*').eq('id', id).maybeSingle()
    existing = result.data
    if (!existing) return NextResponse.json({ error: 'Draft not found.' }, { status: 404 })
  }
  const payload = locationPayload(input, user.id, existing)
  const errors = validateLocation(payload)
  if (errors.length) return NextResponse.json({ saved: false, waiting: true, error: errors[0] }, { status: 422 })
  const privateAddress = payload.private_address
  const writable = { ...payload }
  delete writable.private_address
  if (existing) { delete writable.created_by; delete writable.slug }
  const query = existing
    ? supabase.from('locations').update(writable).eq('id', id).select('id,slug,status,autosaved_at').single()
    : supabase.from('locations').insert(writable).select('id,slug,status,autosaved_at').single()
  const { data, error } = await query
  if (error || !data) return NextResponse.json({ error: message(error, 'Draft could not be saved.') }, { status: 400 })
  const privateResult = await savePrivateDetail(supabase, data.id, privateAddress, user.id)
  if (privateResult.error) return NextResponse.json({ error: 'The draft saved, but its private address could not be secured.' }, { status: 400 })
  return NextResponse.json({ saved: true, draft: data })
}
''')

write("app/plans/actions.js", r'''
"use server"

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { requireUser } from '@/lib/auth/user'
import { pathWithMessage } from '@/lib/auth/redirect'

function value(formData, name, max = 2000) { return String(formData.get(name) || '').trim().slice(0, max) }
function optionalDate(value) { if (!value) return null; const parsed = new Date(value); return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString() }

export async function recordLocationVisit(formData) {
  const session = await requireUser({ onboarding: true })
  const locationId = value(formData, 'location_id', 64)
  const status = value(formData, 'status', 20) === 'visited' ? 'visited' : 'planned'
  const plannedFor = optionalDate(value(formData, 'planned_for', 80))
  const { error } = await session.supabase.from('location_visits').upsert({
    profile_id: session.user.id, location_id: locationId, status,
    planned_for: status === 'planned' ? plannedFor : null,
    visited_at: status === 'visited' ? new Date().toISOString() : null,
    note: value(formData, 'note', 500) || null,
    updated_at: new Date().toISOString()
  }, { onConflict: 'profile_id,location_id' })
  if (error) redirect(pathWithMessage('/plans', 'error', 'The place visit could not be saved.'))
  revalidatePath('/plans')
  redirect(pathWithMessage(status === 'visited' ? '/plans?tab=past' : '/plans?tab=planned', 'success', status === 'visited' ? 'Visit recorded.' : 'Place added to your visit plans.'))
}
''')

plans_page = path("app/plans/page.js").read_text(encoding="utf-8")
plans_page = plans_page.replace("import { LegacyPlansPage } from '@/app/plans/legacy-page'\n", "")
plans_page = plans_page.replace("import { legacySystemsEnabled } from '@/lib/product-vision'\n", "")
plans_page = plans_page.replace("  if (legacySystemsEnabled()) return <LegacyPlansPage searchParams={searchParams} />\n", "")
path("app/plans/page.js").write_text(plans_page, encoding="utf-8")

write("components/admin-shell.js", r'''
import Link from 'next/link'

const links=[['/admin','Overview'],['/admin/cases','Cases'],['/admin/users','Users'],['/admin/content','Locations'],['/admin/security','Security']]

export function AdminShell({ access, children }) {
  return <div className="admin-shell"><header className="admin-header"><div><span className="section-pill section-pill-yellow">Privileged workspace</span><h1>Puddle administration</h1><p>MFA-protected location moderation, venue verification, user safety, and security response.</p></div><Link href="/discover">Exit admin</Link></header><nav className="admin-nav">{links.map(([href,label])=><Link href={href} key={href}>{label}</Link>)}<span>{(access?.roles||[]).join(' · ')}</span></nav>{children}</div>
}
''')

admin_content = path("app/admin/content/page.js").read_text(encoding="utf-8")
admin_content = admin_content.replace("import { legacySystemsEnabled } from '@/lib/product-vision'\n", "")
admin_content = admin_content.replace("  const showLegacy = legacySystemsEnabled()\n  const content = (data?.content || []).filter((item) => showLegacy || item.subject_type !== 'event')\n  const verification = (data?.verification || []).filter((item) => showLegacy || item.subject_type !== 'event')\n", "  const content = (data?.content || []).filter((item) => item.subject_type === 'location')\n  const verification = (data?.verification || []).filter((item) => item.subject_type === 'location')\n")
admin_content = admin_content.replace("{showLegacy ? 'Event and place review' : 'Location review'}", "Location review")
path("app/admin/content/page.js").write_text(admin_content, encoding="utf-8")

place_page = path("app/places/[slug]/page.js").read_text(encoding="utf-8")
place_page = place_page.replace("import { ListingSocial } from '@/components/listing-social'\n", "")
place_page = place_page.replace("  const returnTo = `/places/${result.location.slug}`\n", "")
place_page = place_page.replace("    <ListingSocial kind=\"location\" content={result.location} returnTo={returnTo} />\n", "")
path("app/places/[slug]/page.js").write_text(place_page, encoding="utf-8")

for value in ["app/create/place/page.js", "app/studio/places/[id]/page.js"]:
    content = path(value).read_text(encoding="utf-8")
    content = content.replace("import { AiCreationAssistant } from '@/components/ai-creation-assistant'\n", "")
    content = re.sub(r"<AiCreationAssistant\s+[^>]*/>", "", content)
    path(value).write_text(content, encoding="utf-8")

creator = path("lib/app/creator-data.js").read_text(encoding="utf-8")
creator = re.sub(r"\nexport async function getEditableEvent\(.*?\n}\n\nexport async function getEditableLocation", "\nexport async function getEditableLocation", creator, flags=re.S)
path("lib/app/creator-data.js").write_text(creator, encoding="utf-8")

layout = path("app/layout.js").read_text(encoding="utf-8")
layout = layout.replace("import './stage-five.css'\n", "").replace("import './stage-six.css'\n", "")
path("app/layout.js").write_text(layout, encoding="utf-8")

playwright = path("playwright.config.mjs").read_text(encoding="utf-8")
playwright = playwright.replace("  PUDDLE_LEGACY_SYSTEMS_ENABLED: 'false',\n", "")
path("playwright.config.mjs").write_text(playwright, encoding="utf-8")

# R2 is now required; remove relational fallback and compatibility alias.
infrastructure = path("lib/app/discovery-infrastructure.js").read_text(encoding="utf-8")
infrastructure = infrastructure.replace("import { getDiscoveryFeed, isOpenAt, parseDiscoveryFilters } from './discovery.js'", "import { isOpenAt, parseDiscoveryFilters } from './discovery-filters.js'")
pattern = re.compile(r"\nfunction fallbackFeed\(feed, reason\) \{.*?\nfunction sampled", re.S)
replacement = r'''

export async function getInfrastructureDiscoveryFeed(session, rawFilters = {}) {
  if (!staticCatalogueBaseUrl()) {
    const error = new Error('The schema-v3 R2 catalogue is not configured.')
    error.code = 'R2_CATALOGUE_NOT_CONFIGURED'
    error.status = 503
    throw error
  }
  const staticState = await loadStaticCatalogueNear(session, rawFilters)
  if (staticState.latitude === null || staticState.longitude === null) {
    return r2Feed(session, staticState, { dismissedIds: [], interests: session.profile?.interests || [], locations: [] })
  }
  const overlay = await relationalOverlay(session, staticState)
  return r2Feed(session, staticState, overlay)
}

function sampled'''
infrastructure, count = pattern.subn(replacement, infrastructure)
if count != 1:
    raise RuntimeError(f"Could not remove discovery fallback; replacements={count}")
infrastructure = re.sub(r"\n// Backward-compatible export.*?\nexport const logInfrastructureDiscoveryImpressions = recordSampledInfrastructureAnalytics\s*$", "\n", infrastructure, flags=re.S)
path("lib/app/discovery-infrastructure.js").write_text(infrastructure, encoding="utf-8")

write("app/discover/page.js", r'''
import { after } from 'next/server'
import { AuthMessage } from '@/components/auth-message'
import { DateSwipeWorkspaceV2 } from '@/components/date-swipe-workspace-v2'
import { renderProductPage } from '@/lib/app/render-product-page'
import { getInfrastructureDiscoveryFeed, recordSampledInfrastructureAnalytics } from '@/lib/app/discovery-infrastructure'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Swipe', description: 'Swipe through nearby places.' }
function textParam(value, max = 80) { return String(value || '').trim().slice(0, max) }

export default async function DiscoverPage({ searchParams }) {
  const params = await searchParams
  return renderProductPage(async (session) => {
    const requestedDistance = Number(params?.distance)
    const feedFilters = {
      kind: 'place', date: 'any',
      distance: Number.isFinite(requestedDistance) && requestedDistance > 0 ? Math.min(100, requestedDistance) : session.profile.search_radius_km || 10,
      limit: 12, q: textParam(params?.q), category: textParam(params?.category, 40),
      price: textParam(params?.price, 10) || 'any', amenity: textParam(params?.amenity, 60),
      openNow: params?.openNow === 'true', accessible: params?.accessible === 'true'
    }
    const feed = await getInfrastructureDiscoveryFeed(session, feedFilters)
    after(() => recordSampledInfrastructureAnalytics(session, feed).catch((error) => console.warn(`Discovery analytics failed: ${error.message}`)))
    return <div className="minimal-swipe-page"><AuthMessage searchParams={params} /><DateSwipeWorkspaceV2 initialFeed={feed} /></div>
  })
}
''')

write("app/api/discovery/route.js", r'''
import { after, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isSupabaseConfigured } from '@/lib/supabase/env'
import { getInfrastructureDiscoveryFeed, recordSampledInfrastructureAnalytics } from '@/lib/app/discovery-infrastructure'

export const dynamic = 'force-dynamic'

export async function GET(request) {
  if (!isSupabaseConfigured()) return NextResponse.json({ error: 'Date-location discovery is unavailable.' }, { status: 503 })
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Sign in to swipe through date locations.' }, { status: 401 })
  const { data: profile } = await supabase.from('profiles').select('id,birth_date,interests,latitude,longitude,city,region,country,country_code,timezone,location_label,search_radius_km').eq('id', user.id).maybeSingle()
  const filters = { ...Object.fromEntries(request.nextUrl.searchParams), kind: 'place', date: 'any' }
  const session = { supabase, user, profile: profile || {} }
  try {
    const feed = await getInfrastructureDiscoveryFeed(session, filters)
    after(() => recordSampledInfrastructureAnalytics(session, feed).catch((error) => console.warn(`Discovery analytics failed: ${error.message}`)))
    return NextResponse.json(feed)
  } catch (error) {
    console.warn(`R2 discovery unavailable: ${error.message}`)
    return NextResponse.json({ error: 'Nearby place discovery is temporarily unavailable.' }, { status: Number(error?.status) || 503 })
  }
}
''')

cleanup = path("scripts/cleanup-r2-assets.mjs").read_text(encoding="utf-8")
old = """let releases\nif (registry.releases.length) {\n  releases = registry.releases.map((entry) => entry.release).filter(Boolean)\n} else {\n  const releaseObjects = await allObjects('catalogue/releases/')\n  releases = [...new Set(releaseObjects.map((object) => object.key.split('/')[2]).filter(Boolean))]\n}\nreleases = [...new Set(releases)].sort().reverse()"""
new = """if (!registry.releases.length) {\n  throw new Error('catalogue/release-registry.json is required before cleanup can run.')\n}\nconst releases = [...new Set(registry.releases.map((entry) => entry.release).filter(Boolean))].sort().reverse()"""
if old not in cleanup:
    raise RuntimeError("Cleanup registry fallback marker missing")
cleanup = cleanup.replace(old, new)
path("scripts/cleanup-r2-assets.mjs").write_text(cleanup, encoding="utf-8")

# Consolidate the cleanup migration and make batched actions independent.
migration = path("supabase/migrations/10028_r2_runtime_second_optimization.sql").read_text(encoding="utf-8")
migration = re.sub(r"\ncreate or replace function public\.record_static_catalogue_action_v1\(.*?grant execute on function public\.record_static_catalogue_action_v1\(uuid,text,text,text,uuid\) to authenticated;\n", "\n", migration, flags=re.S)
action_start = migration.index("-- Preserve action ordering while paying the HTTP/auth/rate-limit overhead once.")
cleanup_start = migration.index("-- Delete expired attribution rows and cold relational copies in one database call,")
prefix = migration[:action_start]
new_actions = r'''
-- Preserve ordered, idempotent action batches without depending on v1/v2 RPCs.
create table if not exists public.discovery_action_receipts (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  event_id uuid not null,
  sequence integer not null default 0,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key(profile_id,event_id)
);
create index if not exists discovery_action_receipts_created_idx on public.discovery_action_receipts(created_at);
alter table public.discovery_action_receipts enable row level security;
revoke all on table public.discovery_action_receipts from public,anon,authenticated;
grant select,insert,delete on table public.discovery_action_receipts to service_role;

create or replace function public.record_discovery_actions_v3(actions jsonb)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  actor uuid := auth.uid();
  item jsonb;
  target_id uuid;
  action_name text;
  requested_action text;
  request_uuid uuid;
  event_uuid uuid;
  sequence_value integer;
  static_ephemeral boolean;
  previous public.discovery_actions%rowtype;
  action_result jsonb;
  stored_result jsonb;
  touch_reason text;
begin
  if actor is null then raise exception 'authentication required'; end if;
  if jsonb_typeof(coalesce(actions,'[]'::jsonb))<>'array' then raise exception 'actions must be an array'; end if;
  if jsonb_array_length(coalesce(actions,'[]'::jsonb)) not between 1 and 20 then raise exception 'invalid action batch size'; end if;

  for item in
    select value from jsonb_array_elements(actions)
    order by coalesce((value->>'sequence')::integer,0)
  loop
    if coalesce(item->>'contentKind','place')<>'place' then raise exception 'only place actions are supported'; end if;
    target_id := (item->>'contentId')::uuid;
    action_name := item->>'action';
    requested_action := coalesce(item->>'requestedAction',action_name);
    request_uuid := nullif(item->>'requestId','')::uuid;
    event_uuid := nullif(item->>'eventId','')::uuid;
    sequence_value := coalesce((item->>'sequence')::integer,0);
    static_ephemeral := coalesce((item->>'staticEphemeral')::boolean,false);
    if event_uuid is null then raise exception 'eventId is required'; end if;
    if action_name not in ('saved','interested','dismissed','visited','opened','undo') then raise exception 'invalid action'; end if;

    perform pg_advisory_xact_lock(hashtextextended(actor::text||':'||event_uuid::text,0));
    stored_result := null;
    select receipt.result into stored_result
    from public.discovery_action_receipts receipt
    where receipt.profile_id=actor and receipt.event_id=event_uuid;
    if stored_result is not null then
      action_result := stored_result;
    elsif static_ephemeral and action_name='dismissed' then
      insert into public.static_catalogue_actions(user_id,location_id,expires_at)
      values(actor,target_id,now()+interval '90 days')
      on conflict(user_id,location_id) do update set expires_at=excluded.expires_at;
      action_result := jsonb_build_object('action','dismissed','locationId',target_id);
    elsif static_ephemeral and action_name='undo' and not exists(select 1 from public.locations where id=target_id) then
      delete from public.static_catalogue_actions where user_id=actor and location_id=target_id;
      action_result := jsonb_build_object('action','undo','locationId',target_id,'undone',true);
    else
      if not exists(select 1 from public.locations where id=target_id and status='published') then raise exception 'place unavailable'; end if;
      if action_name='opened' then
        action_result := jsonb_build_object('action','opened','locationId',target_id);
      elsif action_name='undo' then
        select * into previous
        from public.discovery_actions
        where profile_id=actor and location_id=target_id and undone_at is null
        order by created_at desc,id desc limit 1 for update;
        if previous.id is null then
          action_result := jsonb_build_object('action','undo','locationId',target_id,'undone',false);
        else
          update public.discovery_actions set undone_at=now() where id=previous.id;
          if previous.action in ('saved','interested','visited') then
            delete from public.user_content_states
            where profile_id=actor and location_id=target_id and state=previous.action;
          end if;
          action_result := jsonb_build_object('action','undo','locationId',target_id,'undone',true,'previousAction',previous.action);
        end if;
      else
        if action_name in ('saved','interested','visited') then
          update public.discovery_actions set undone_at=now()
          where profile_id=actor and location_id=target_id and action='dismissed' and undone_at is null;
          delete from public.user_content_states
          where profile_id=actor and location_id=target_id and state=action_name;
          insert into public.user_content_states(profile_id,location_id,state)
          values(actor,target_id,action_name);
        end if;
        insert into public.discovery_actions(profile_id,request_id,content_kind,location_id,action)
        values(actor,request_uuid,'place',target_id,action_name);
        action_result := jsonb_build_object('action',action_name,'locationId',target_id,'perfectPick',requested_action='perfect');
      end if;
    end if;

    touch_reason := case
      when requested_action='perfect' then 'perfect'
      when action_name in ('saved','interested') then 'saved'
      when action_name='visited' then 'visited'
      when action_name='opened' then 'opened'
      else null
    end;
    if touch_reason is not null then
      perform public.touch_static_catalogue_materializations_v1(array[target_id],touch_reason);
    end if;

    if stored_result is null then
      action_result := action_result || jsonb_build_object('eventId',event_uuid,'sequence',sequence_value);
      insert into public.discovery_action_receipts(profile_id,event_id,sequence,result)
      values(actor,event_uuid,sequence_value,action_result);
    end if;
    result := result || jsonb_build_array(action_result);
  end loop;
  return result;
end;
$$;
revoke all on function public.record_discovery_actions_v3(jsonb) from public,anon;
grant execute on function public.record_discovery_actions_v3(jsonb) to authenticated;

-- Remove obsolete action compatibility functions now that all clients use v3.
drop function if exists public.record_discovery_action_v2(text,uuid,text,text,uuid,text,text,jsonb,boolean,text,text);
drop function if exists public.record_static_catalogue_action_v1(uuid,text,text,text,uuid);
do $$
declare function_row record;
begin
  for function_row in
    select procedure.oid,namespace.nspname,procedure.proname,pg_get_function_identity_arguments(procedure.oid) arguments
    from pg_proc procedure join pg_namespace namespace on namespace.oid=procedure.pronamespace
    where namespace.nspname='public' and procedure.proname='record_discovery_action_v1'
  loop
    execute format('drop function %I.%I(%s)',function_row.nspname,function_row.proname,function_row.arguments);
  end loop;
end;
$$;
'''
new_cleanup = r'''
-- Dry-run-aware cleanup preparation. The worker deletes returned R2 objects only in apply mode.
create or replace function public.prepare_r2_cleanup_v2(
  photo_limit integer default 500,
  location_limit integer default 500,
  apply_changes boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  safe_photo_limit integer := least(5000,greatest(1,coalesce(photo_limit,500)));
  safe_location_limit integer := least(5000,greatest(1,coalesce(location_limit,500)));
  changed_locations uuid[] := '{}'::uuid[];
  expired_count integer := 0;
  cold_count integer := 0;
  deleted_locations integer := 0;
  location_row record;
  orphan_rows jsonb;
begin
  if coalesce(auth.role()::text,'')<>'service_role' then raise exception 'service role required'; end if;
  if apply_changes then
    with targets as (
      select source.id,source.location_id from public.location_photo_sources source
      where source.media_object_id is not null and (source.status in ('rejected','archived') or source.expires_at<now())
      order by source.verified_at asc nulls first limit safe_photo_limit
    ), removed as (
      delete from public.location_photo_sources source using targets where source.id=targets.id returning targets.location_id
    )
    select coalesce(array_agg(distinct location_id),'{}'::uuid[]),count(*) into changed_locations,expired_count from removed;
  else
    select coalesce(array_agg(distinct target.location_id),'{}'::uuid[]),count(*) into changed_locations,expired_count
    from (
      select source.location_id from public.location_photo_sources source
      where source.media_object_id is not null and (source.status in ('rejected','archived') or source.expires_at<now())
      order by source.verified_at asc nulls first limit safe_photo_limit
    ) target;
  end if;
  select count(*) into cold_count from (
    select materialization.location_id from public.static_catalogue_materializations materialization
    where materialization.expires_at<now() order by materialization.expires_at asc limit safe_location_limit
  ) target;
  if apply_changes then
    for location_row in
      select materialization.location_id from public.static_catalogue_materializations materialization
      where materialization.expires_at<now() order by materialization.expires_at asc limit safe_location_limit
    loop
      if public.delete_cold_static_materialization_v1(location_row.location_id) then deleted_locations := deleted_locations+1; end if;
    end loop;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',media.id,'storageBackend',media.storage_backend,'storageKey',media.storage_key)),'[]'::jsonb)
  into orphan_rows
  from (
    select object.id,object.storage_backend,object.storage_key from public.media_objects object
    where not exists(select 1 from public.location_photo_sources source where source.media_object_id=object.id)
    order by object.created_at asc limit safe_photo_limit
  ) media;
  return jsonb_build_object(
    'mode',case when apply_changes then 'apply' else 'dry-run' end,
    'expiredPhotoRows',expired_count,'changedLocationIds',to_jsonb(changed_locations),
    'coldMaterializations',cold_count,'deletedLocations',deleted_locations,
    'orphanMedia',coalesce(orphan_rows,'[]'::jsonb)
  );
end;
$$;
revoke all on function public.prepare_r2_cleanup_v2(integer,integer,boolean) from public,anon,authenticated;
grant execute on function public.prepare_r2_cleanup_v2(integer,integer,boolean) to service_role;

create or replace function public.delete_unreferenced_media_objects_v1(media_ids uuid[])
returns integer
language plpgsql
security definer
set search_path=public
as $$
declare changed integer;
begin
  if coalesce(auth.role()::text,'')<>'service_role' then raise exception 'service role required'; end if;
  delete from public.media_objects object
  where object.id=any(coalesce(media_ids,'{}'::uuid[]))
    and not exists(select 1 from public.location_photo_sources source where source.media_object_id=object.id);
  get diagnostics changed=row_count;
  return changed;
end;
$$;
revoke all on function public.delete_unreferenced_media_objects_v1(uuid[]) from public,anon,authenticated;
grant execute on function public.delete_unreferenced_media_objects_v1(uuid[]) to service_role;
'''
path("supabase/migrations/10028_r2_runtime_second_optimization.sql").write_text((prefix + new_actions + "\n" + new_cleanup).rstrip() + "\n", encoding="utf-8")

# Environment and package surface no longer advertise rollback systems.
env = path(".env.example").read_text(encoding="utf-8")
env = re.sub(r"# Location-first is the production default.*?PUDDLE_LEGACY_SYSTEMS_ENABLED=false\n\n", "", env, flags=re.S)
env = re.sub(r"# Legacy rollback only: Stage 5 Stripe Connect and Checkout\..*?TICKET_TOKEN_ISSUER=puddle\.you\n\n", "", env, flags=re.S)
env = env.replace("STATIC_CATALOGUE_MAX_TILES=64\n", "STATIC_CATALOGUE_MAX_TILES=64\nSTATIC_CATALOGUE_TILE_CONCURRENCY=6\nDISCOVERY_ANALYTICS_SAMPLE_RATE=0.1\n")
path(".env.example").write_text(env, encoding="utf-8")

package_path = path("package.json")
package = json.loads(package_path.read_text(encoding="utf-8"))
for name in list(package["scripts"]):
    if name.startswith("legacy:") or name in {"stage8:test", "embeddings:generate", "recommendations:metrics"}:
        package["scripts"].pop(name, None)
check = package["scripts"]["check"]
for token in [
    " tests/unit/product-vision.test.mjs", " && node scripts/check-product-vision.mjs",
    " && node scripts/check-stage-five.mjs", " && node scripts/check-stage-eight.mjs"
]:
    check = check.replace(token, "")
package["scripts"]["check"] = check
package["dependencies"].pop("html5-qrcode", None)
package["dependencies"].pop("qrcode", None)
package_path.write_text(json.dumps(package, separators=(",", ":")) + "\n", encoding="utf-8")

write("README.md", r'''
# Puddle

Puddle is a location-first swipe-and-match product for choosing date and hangout locations.

## Product flow

```text
location preferences
→ twelve nearby schema-v3 R2 cards
→ Pass, Save, or Perfect Pick
→ solo shortlist, DateMatch, or Group Hangout Match
→ choose a location and time
```

The active product includes authentication and onboarding, R2-first global place discovery, cached open-license photos, Google Places UI Kit fallbacks, saved and planned locations, shared matching rooms, location contributions and claims, reports, moderation, recommendation preferences, and security administration.

The previous event marketplace, ticketing, payments, creator-event studio, general social network, direct messages, live-location sharing, and complex itinerary systems have been permanently removed from the executable application. Historical database migrations remain so existing databases and clean rebuilds stay reproducible.

## Run locally

```bash
cp .env.example .env.local
npm install
npm run check
npm run dev
```

## Static catalogue operations

```bash
npm run locations:catalogue:build-static -- \
  --source=overture \
  --file=places.geojsonseq \
  --output=dist/static-catalogue \
  --release=2026-08-03-global \
  --zoom=10

npm run locations:catalogue:publish-r2 -- --directory=dist/static-catalogue --apply
```

Discovery requires a published schema-v3 catalogue and `catalogue/release-registry.json`. There is no relational catalogue fallback.

## Validation

```bash
npm run check
npm run build
npm run e2e:test
```
''')

# Update infrastructure documentation to the permanent schema-v3 contract.
doc_path = path("docs/R2_GOOGLE_INFRASTRUCTURE.md")
doc = doc_path.read_text(encoding="utf-8")
doc = doc.replace("matching detail sidecars and are loaded only when a filter or materialization needs them.", "matching detail and provenance sidecars. Compact filter fields remain in deck tiles; full details load only for materialization or an opened card.")
doc = doc.replace("supabase/migrations/10028_r2_runtime_second_optimization.sql\nsupabase/migrations/10029_r2_cleanup_batch_preview.sql", "supabase/migrations/10028_r2_runtime_second_optimization.sql")
doc = doc.replace("schema-v2", "schema-v3").replace("schema v2", "schema v3")
doc += "\n## Permanent cutover\n\nSchema v3 and the plural `/api/discovery/actions` endpoint are mandatory. The single-action endpoint, relational discovery fallback, legacy product gate, and release-prefix cleanup scan have been removed. Cleanup requires `catalogue/release-registry.json`.\n"
doc_path.write_text(doc, encoding="utf-8")

# Update source-level regression tests for the permanent cutover.
write("tests/unit/r2-runtime-optimizations.test.mjs", r'''
import test from 'node:test'
import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'

const read = (value) => readFile(new URL(`../../${value}`, import.meta.url), 'utf8')

async function missing(value) {
  try { await access(new URL(`../../${value}`, import.meta.url)); return false } catch { return true }
}

test('the production runtime is R2-only and uses ordered batched actions', async () => {
  const discovery = await read('lib/app/discovery-infrastructure.js')
  const route = await read('app/api/discovery/actions/route.js')
  const client = await read('components/date-swipe-workspace-v2.js')
  assert.equal(discovery.includes('getDiscoveryFeed'), false)
  assert.equal(discovery.includes('supabase-fallback'), false)
  assert.equal(discovery.includes('logInfrastructureDiscoveryImpressions'), false)
  assert.ok(discovery.includes('R2_CATALOGUE_NOT_CONFIGURED'))
  assert.ok(route.includes("record_discovery_actions_v3"))
  assert.ok(client.includes("'/api/discovery/actions'"))
  assert.ok(await missing('app/api/discovery/action/route.js'))
  assert.ok(await missing('lib/app/discovery.js'))
})

test('schema-v3 compact filters and provenance shards are mandatory', async () => {
  const catalogue = await read('lib/app/static-catalogue.js')
  const builder = await read('scripts/build-static-location-catalogue.mjs')
  assert.ok(catalogue.includes('STATIC_SCHEMA_VERSION = 3'))
  assert.ok(catalogue.includes('PROVENANCE_FIELDS'))
  assert.ok(catalogue.includes('accessibilityFlags'))
  assert.ok(builder.includes("'provenance'"))
})

test('one migration owns cleanup and action v3 is independent', async () => {
  const migration = await read('supabase/migrations/10028_r2_runtime_second_optimization.sql')
  assert.ok(await missing('supabase/migrations/10029_r2_cleanup_batch_preview.sql'))
  assert.ok(migration.includes('prepare_r2_cleanup_v2'))
  assert.equal(migration.includes('prepare_r2_cleanup_v1'), false)
  assert.equal(migration.includes('public.record_discovery_action_v2('), false)
  assert.ok(migration.includes('discovery_action_receipts'))
  assert.ok(migration.includes("drop function if exists public.record_discovery_action_v2"))
})

test('cleanup requires the release registry instead of scanning all releases', async () => {
  const cleanup = await read('scripts/cleanup-r2-assets.mjs')
  assert.ok(cleanup.includes('release-registry.json is required'))
  assert.equal(cleanup.includes("allObjects('catalogue/releases/')"), false)
})

test('legacy executable product surfaces are absent', async () => {
  for (const value of [
    'lib/product-vision.js', 'app/events', 'app/api/stripe', 'app/friends', 'app/inbox',
    'app/api/location-sharing', 'lib/stripe', 'lib/tickets', 'components/event-editor.js'
  ]) assert.ok(await missing(value), `${value} should be removed`)
  const proxy = await read('proxy.js')
  const env = await read('.env.example')
  assert.equal(proxy.includes('legacySystemsEnabled'), false)
  assert.equal(env.includes('PUDDLE_LEGACY_SYSTEMS_ENABLED'), false)
  assert.equal(env.includes('STRIPE_SECRET_KEY'), false)
})
''')

write("tests/unit/static-catalogue-materialization.test.mjs", r'''
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { staticCatalogueLocationId, staticMaterializedSlug } from '../../lib/app/static-catalogue-id.js'

const read = (value) => readFile(new URL(`../../${value}`, import.meta.url), 'utf8')

test('static catalogue IDs and slugs remain deterministic', () => {
  const id = staticCatalogueLocationId('overture', 'place-123')
  assert.equal(id, staticCatalogueLocationId('overture', 'place-123'))
  assert.notEqual(id, staticCatalogueLocationId('fsq_os', 'place-123'))
  assert.match(staticMaterializedSlug({ source: 'overture', sourcePlaceId: 'place-123', name: 'Café & Garden' }, id), /^cafe-garden-[0-9a-f]{12}$/)
})

test('exact signed references batch materialization by tile', async () => {
  const materializer = await read('lib/app/static-catalogue-materialization.js')
  assert.ok(materializer.includes('fetchStaticPlacesByReferences'))
  assert.ok(materializer.includes('materialize_static_catalogue_locations_v2'))
  assert.equal(materializer.includes('fetchNearbyStaticPlaces'), false)
})

test('only the plural batched action boundary remains', async () => {
  const route = await read('app/api/discovery/actions/route.js')
  assert.ok(route.includes('MAX_ACTIONS = 20'))
  assert.ok(route.includes('record_discovery_actions_v3'))
  assert.equal(route.includes('record_discovery_action_v2'), false)
})
''')

# Static catalogue integration expectations are schema v3.
integration_path = path("tests/integration/static-catalogue-build.test.mjs")
integration = integration_path.read_text(encoding="utf-8").replace("assert.equal(rootManifest.schema, 2)", "assert.equal(rootManifest.schema, 3)")
path("tests/integration/static-catalogue-build.test.mjs").write_text(integration, encoding="utf-8")

# Validate schema v3 explicitly before any R2 publish step.
workflow_path = path(".github/workflows/static-catalogue-r2.yml")
workflow = workflow_path.read_text(encoding="utf-8")
marker = "      - name: Publish immutable release to R2\n"
validation = "      - name: Validate schema-v3 manifest\n        run: node -e \"const fs=require('fs');const m=JSON.parse(fs.readFileSync('dist/static-catalogue/catalogue/manifest.json'));if(m.schema!==3)throw new Error('Expected schema v3');\"\n"
if validation not in workflow:
    workflow = workflow.replace(marker, validation + marker)
workflow_path.write_text(workflow, encoding="utf-8")

print('Permanent location-first cutover files prepared.')
