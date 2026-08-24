"use server"

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { requireUser } from '@/lib/auth/user'
import { createAdminClient } from '@/lib/supabase/admin'
import { createMembershipPortal, createStripeCustomer, createTinderCheckout, stripeMembershipConfigured } from '@/lib/billing/stripe'
import { ageFromBirthDate, getMembershipSnapshot } from '@/lib/app/membership-data'
import { pathWithMessage } from '@/lib/auth/redirect'

function membershipPath(kind, message) {
  return pathWithMessage('/membership', kind, message)
}

function canonicalOrigin() {
  const raw = String(process.env.NEXT_PUBLIC_SITE_URL || '').trim()
  try {
    const url = new URL(raw)
    if (process.env.NODE_ENV === 'production' && url.protocol !== 'https:') throw new Error('invalid origin')
    return url.origin
  } catch {
    return process.env.NODE_ENV === 'production' ? null : 'http://localhost:3000'
  }
}

export async function startTinderCheckout() {
  const session = await requireUser({ onboarding: true })
  if (!stripeMembershipConfigured()) redirect(membershipPath('error', 'Payments are not configured yet.'))
  const age = ageFromBirthDate(session.profile?.birth_date)
  if (!Number.isFinite(age) || age < 18) redirect(membershipPath('error', 'Tinder tier global connections require users to be at least 18.'))
  const origin = canonicalOrigin()
  if (!origin) redirect(membershipPath('error', 'The payment return address is not configured.'))

  const snapshot = await getMembershipSnapshot(session)
  if (snapshot.active) redirect('/global-matches')

  let customerId = snapshot.membership?.stripe_customer_id || null
  try {
    if (!customerId) {
      const customer = await createStripeCustomer({ email: session.user.email, userId: session.user.id })
      customerId = customer.id
      const admin = createAdminClient()
      const saved = await admin.from('puddle_memberships').upsert({
        user_id: session.user.id,
        tier: 'free',
        status: snapshot.membership?.status || 'inactive',
        stripe_customer_id: customerId,
        updated_at: new Date().toISOString()
      }, { onConflict: 'user_id' })
      if (saved.error) throw saved.error
    }
    const checkout = await createTinderCheckout({ customerId, userId: session.user.id, origin })
    if (!checkout?.url) throw new Error('Checkout did not return a payment page.')
    redirect(checkout.url)
  } catch (error) {
    if (String(error?.digest || '').startsWith('NEXT_REDIRECT')) throw error
    redirect(membershipPath('error', 'Checkout could not be started. Please try again.'))
  }
}

export async function openMembershipPortal() {
  const session = await requireUser({ onboarding: true })
  const snapshot = await getMembershipSnapshot(session)
  const customerId = snapshot.membership?.stripe_customer_id
  const origin = canonicalOrigin()
  if (!customerId || !origin) redirect(membershipPath('error', 'No billing account is available yet.'))
  try {
    const portal = await createMembershipPortal({ customerId, origin })
    if (!portal?.url) throw new Error('Portal URL missing')
    redirect(portal.url)
  } catch (error) {
    if (String(error?.digest || '').startsWith('NEXT_REDIRECT')) throw error
    redirect(membershipPath('error', 'Billing settings could not be opened. Please try again.'))
  }
}

export async function saveGlobalPreference(formData) {
  const session = await requireUser({ onboarding: true })
  const snapshot = await getMembershipSnapshot(session)
  if (!snapshot.active || !snapshot.adult) redirect(membershipPath('error', 'Tinder tier and age 18 or older are required for global connections.'))
  const intentValue = String(formData.get('intent') || 'either')
  const intent = ['date', 'hangout', 'either'].includes(intentValue) ? intentValue : 'either'
  const discoverable = formData.get('discoverable') === 'on'
  const saved = await session.supabase.from('global_connection_preferences').upsert({
    user_id: session.user.id,
    discoverable,
    intent,
    updated_at: new Date().toISOString()
  }, { onConflict: 'user_id' })
  if (saved.error) redirect(membershipPath('error', 'Your global visibility setting could not be saved.'))
  revalidatePath('/membership')
  revalidatePath('/global-matches')
  redirect(membershipPath('success', discoverable ? 'Global connections are on.' : 'Global connections are off.'))
}
