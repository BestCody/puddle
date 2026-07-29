import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isSupabaseConfigured } from '@/lib/supabase/env'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

export async function GET(_request, context) {
  if (!isSupabaseConfigured()) return NextResponse.json({ error: 'Media is unavailable.' }, { status: 503 })
  const { id } = await context.params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Sign in to view private media.' }, { status: 401 })

  const { data: asset, error } = await supabase.from('media_assets')
    .select('id,bucket_id,object_path,visibility,status,mime_type')
    .eq('id', id)
    .maybeSingle()
  if (error || !asset) return NextResponse.json({ error: 'Media not found.' }, { status: 404 })

  let admin
  try { admin = createAdminClient() } catch { return NextResponse.json({ error: 'Media links are temporarily unavailable.' }, { status: 503 }) }
  if (asset.visibility === 'public' && asset.status === 'approved') {
    const url = admin.storage.from(asset.bucket_id).getPublicUrl(asset.object_path).data.publicUrl
    return NextResponse.json({ url, expiresIn: null })
  }

  const { data, error: signError } = await admin.storage.from(asset.bucket_id).createSignedUrl(asset.object_path, 600)
  if (signError || !data?.signedUrl) return NextResponse.json({ error: 'A private link could not be created.' }, { status: 400 })
  return NextResponse.json({ url: data.signedUrl, expiresIn: 600 })
}
