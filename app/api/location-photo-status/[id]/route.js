import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isSupabaseConfigured } from '@/lib/supabase/env'

export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const PUBLIC_STATUSES = new Set(['pending', 'processing', 'matched', 'no_match', 'failed', 'skipped'])

function response(body, status = 200) {
  return NextResponse.json(body, { status, headers: { 'cache-control': 'private, no-store' } })
}

export async function GET(_request, context) {
  if (!isSupabaseConfigured()) return response({ error: 'Photo status is unavailable.' }, 503)
  const { id } = await context.params
  if (!UUID.test(String(id || ''))) return response({ error: 'Location not found.' }, 404)

  const admin = createAdminClient()
  const { data: location, error } = await admin
    .from('locations')
    .select('id,status,visibility,photo_enrichment_status')
    .eq('id', id)
    .maybeSingle()
  if (error || !location || location.status !== 'published' || location.visibility !== 'public') {
    return response({ error: 'Location not found.' }, 404)
  }

  const { data: approvedPhoto, error: photoError } = await admin
    .from('location_photo_sources')
    .select('id')
    .eq('location_id', id)
    .eq('status', 'approved')
    .eq('is_ai_generated', false)
    .limit(1)
    .maybeSingle()
  if (photoError) return response({ error: 'Photo status is unavailable.' }, 503)

  const storedStatus = PUBLIC_STATUSES.has(location.photo_enrichment_status)
    ? location.photo_enrichment_status
    : 'pending'
  return response({ status: approvedPhoto ? 'matched' : storedStatus })
}
