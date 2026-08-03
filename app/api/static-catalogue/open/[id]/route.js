import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { isSupabaseConfigured } from '@/lib/supabase/env'
import { materializeStaticCatalogueLocations } from '@/lib/app/static-catalogue-materialization'

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
    signIn.searchParams.set('next', `/api/static-catalogue/open/${id}`)
    return NextResponse.redirect(signIn)
  }

  const profile = await supabase
    .from('profiles')
    .select('latitude,longitude,search_radius_km')
    .eq('id', user.id)
    .maybeSingle()
  const latitude = Number(profile.data?.latitude)
  const longitude = Number(profile.data?.longitude)
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return NextResponse.redirect(new URL('/account', request.url))
  }

  try {
    const result = await materializeStaticCatalogueLocations({
      admin: createAdminClient(),
      latitude,
      longitude,
      radiusKm: Math.max(25, Number(profile.data?.search_radius_km || 25), 100),
      locationIds: [id]
    })
    if (!result.materialized.has(id)) return NextResponse.redirect(new URL('/discover', request.url))
    const row = await createAdminClient().from('locations').select('slug').eq('id', id).maybeSingle()
    if (!row.data?.slug) return NextResponse.redirect(new URL('/discover', request.url))
    return NextResponse.redirect(new URL(`/places/${encodeURIComponent(row.data.slug)}`, request.url))
  } catch {
    return NextResponse.redirect(new URL('/discover', request.url))
  }
}
