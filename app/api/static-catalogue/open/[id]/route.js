import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { isSupabaseConfigured } from '@/lib/supabase/env'
import { materializeStaticCatalogueReferences } from '@/lib/app/static-catalogue-materialization'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export const dynamic = 'force-dynamic'

export async function GET(request, context) {
  if (!isSupabaseConfigured()) return NextResponse.redirect(new URL('/discover', request.url))
  const { id } = await context.params
  if (!UUID.test(String(id || ''))) return NextResponse.redirect(new URL('/discover', request.url))

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    const signIn = new URL('/sign-in', request.url)
    signIn.searchParams.set('next', `${new URL(request.url).pathname}${new URL(request.url).search}`)
    return NextResponse.redirect(signIn)
  }

  const admin = createAdminClient()
  try {
    let resolvedId = id
    let row = await admin.from('locations').select('slug').eq('id', id).maybeSingle()
    if (row.error && row.error.code !== 'PGRST116') throw row.error
    if (!row.data?.slug) {
      const staticRef = new URL(request.url).searchParams.get('ref')
      if (!staticRef) return NextResponse.redirect(new URL('/discover', request.url))
      const result = await materializeStaticCatalogueReferences({
        admin,
        locationIds: [id],
        references: [{ id, token: staticRef }]
      })
      if (!result.materialized.has(id)) return NextResponse.redirect(new URL('/discover', request.url))
      resolvedId = result.materialized.get(id)?.id || id
      row = await admin.from('locations').select('slug').eq('id', resolvedId).maybeSingle()
    }
    if (!row.data?.slug) return NextResponse.redirect(new URL('/discover', request.url))
    await supabase.rpc('touch_static_catalogue_materializations_v1', {
      location_ids: [resolvedId],
      touch_reason: 'opened'
    })
    return NextResponse.redirect(new URL(`/places/${encodeURIComponent(row.data.slug)}`, request.url))
  } catch {
    return NextResponse.redirect(new URL('/discover', request.url))
  }
}
