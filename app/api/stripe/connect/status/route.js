import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { retrieveAccount } from '@/lib/stripe/client'
import { isSupabaseConfigured } from '@/lib/supabase/env'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  if (!isSupabaseConfigured()) return NextResponse.json({ error: 'Payout status is unavailable.' }, { status: 503 })
  const supabase = await createClient(); const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Sign in to view payouts.' }, { status: 401 })
  const admin = createAdminClient()
  const { data: record } = await admin.from('stripe_connected_accounts').select('*').eq('profile_id', user.id).maybeSingle()
  if (!record?.stripe_account_id) return NextResponse.json({ account: null })
  try {
    const account = await retrieveAccount(record.stripe_account_id)
    const fields = { details_submitted: Boolean(account.details_submitted), charges_enabled: Boolean(account.charges_enabled), payouts_enabled: Boolean(account.payouts_enabled), identity_status: account.requirements?.disabled_reason ? 'restricted' : account.charges_enabled && account.payouts_enabled ? 'verified' : account.details_submitted ? 'submitted' : 'pending', payout_status: account.payouts_enabled ? 'enabled' : 'pending', requirements_due: account.requirements?.currently_due || [], disabled_reason: account.requirements?.disabled_reason || null, updated_at: new Date().toISOString() }
    await admin.from('stripe_connected_accounts').update(fields).eq('profile_id', user.id)
    return NextResponse.json({ account: { ...record, ...fields } })
  } catch { return NextResponse.json({ account: record, warning: 'Stripe status could not refresh.' }) }
}
