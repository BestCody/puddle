import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createAccountLink, createConnectedAccount, retrieveAccount } from '@/lib/stripe/client'
import { isSupabaseConfigured } from '@/lib/supabase/env'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function site(request) { return process.env.NEXT_PUBLIC_SITE_URL || new URL(request.url).origin }

export async function POST(request) {
  if (!isSupabaseConfigured()) return NextResponse.json({ error: 'Payout onboarding is unavailable.' }, { status: 503 })
  const supabase = await createClient(); const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Sign in to set up payouts.' }, { status: 401 })
  const admin = createAdminClient()
  try {
    let { data: record } = await admin.from('stripe_connected_accounts').select('*').eq('profile_id', user.id).maybeSingle()
    let account
    if (!record?.stripe_account_id) {
      account = await createConnectedAccount({ email: user.email, profileId: user.id, country: process.env.STRIPE_CONNECT_COUNTRY || 'CA' })
      const inserted = await admin.from('stripe_connected_accounts').upsert({ profile_id: user.id, stripe_account_id: account.id, account_type: account.type || 'express', country: account.country, details_submitted: account.details_submitted, charges_enabled: account.charges_enabled, payouts_enabled: account.payouts_enabled, identity_status: 'pending', payout_status: 'pending', requirements_due: account.requirements?.currently_due || [], disabled_reason: account.requirements?.disabled_reason || null, updated_at: new Date().toISOString() }, { onConflict: 'profile_id' }).select('*').single()
      if (inserted.error) throw inserted.error
      record = inserted.data
    } else account = await retrieveAccount(record.stripe_account_id)
    await admin.from('stripe_connected_accounts').update({ details_submitted: Boolean(account.details_submitted), charges_enabled: Boolean(account.charges_enabled), payouts_enabled: Boolean(account.payouts_enabled), identity_status: account.requirements?.disabled_reason ? 'restricted' : account.charges_enabled && account.payouts_enabled ? 'verified' : account.details_submitted ? 'submitted' : 'pending', payout_status: account.payouts_enabled ? 'enabled' : 'pending', requirements_due: account.requirements?.currently_due || [], disabled_reason: account.requirements?.disabled_reason || null, updated_at: new Date().toISOString() }).eq('profile_id', user.id)
    const base = site(request)
    const link = await createAccountLink({ accountId: account.id, refreshUrl: `${base}/settings/payouts?stripe=refresh`, returnUrl: `${base}/settings/payouts?stripe=returned` })
    return NextResponse.json({ url: link.url })
  } catch (error) {
    return NextResponse.json({ error: String(error?.message || 'Payout onboarding could not start.').slice(0, 240) }, { status: 400 })
  }
}
