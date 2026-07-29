import { createClient } from '@/lib/supabase/server'

async function safe(query, fallback = null) {
  try { const { data, error } = await query; return error ? fallback : data ?? fallback } catch { return fallback }
}

export async function getPublicTicketOffer(eventId) {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('public_ticket_tiers_v1', { target_event: eventId })
  return error ? [] : data || []
}

export async function getWallet({ supabase, user }) {
  const [tickets, transfers, refunds] = await Promise.all([
    safe(supabase.from('tickets').select('id,event_id,order_id,status,ticket_number,token_version,signed_at,checked_in_at,created_at,ticket_types(name,price_cents,currency),events(title,slug,starts_at,ends_at,timezone,locations(name,city)),orders(receipt_url,status,amount_total_cents,currency)').eq('owner_id', user.id).order('created_at', { ascending: false }), []),
    safe(supabase.from('ticket_transfers').select('id,ticket_id,status,recipient_id,expires_at,created_at,tickets(ticket_number,events(title,slug)),profiles!ticket_transfers_recipient_id_fkey(display_name,username)').or(`sender_id.eq.${user.id},recipient_id.eq.${user.id}`).order('created_at', { ascending: false }), []),
    safe(supabase.from('refund_requests').select('id,order_id,amount_cents,status,reason,requested_at,orders(event_id,events(title,slug))').eq('requester_id', user.id).order('requested_at', { ascending: false }), [])
  ])
  return { tickets, transfers, refunds }
}

export async function getTicketDetail({ supabase, user }, id) {
  return safe(supabase.from('tickets').select('id,event_id,order_id,owner_id,status,ticket_number,token_version,signed_at,checked_in_at,created_at,ticket_types(name,description,price_cents,currency),events(title,slug,starts_at,ends_at,timezone,locations(name,address_public,city)),orders(receipt_url,status,amount_total_cents,currency)').eq('id', id).eq('owner_id', user.id).maybeSingle())
}

export async function getPayoutStatus({ supabase, user }) {
  return safe(supabase.from('stripe_connected_accounts').select('stripe_account_id,account_type,country,details_submitted,charges_enabled,payouts_enabled,identity_status,payout_status,requirements_due,disabled_reason,fraud_hold,updated_at').eq('profile_id', user.id).maybeSingle())
}

export async function getEventFinanceDashboard({ supabase }, eventId) {
  const { data, error } = await supabase.rpc('event_ticketing_dashboard_v1', { target_event: eventId })
  if (error) throw new Error('Ticket finance data is unavailable.')
  return data
}

export async function getCheckinDashboard({ supabase }, eventId) {
  const { data, error } = await supabase.rpc('event_checkin_dashboard_v1', { target_event: eventId })
  if (error) throw new Error('Check-in tools are unavailable.')
  return data
}
