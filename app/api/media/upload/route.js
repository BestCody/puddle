import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isSupabaseConfigured } from '@/lib/supabase/env'
import { createAdminClient } from '@/lib/supabase/admin'
import { mediaObjectPath, mediaPolicy, processMediaFile } from '@/lib/media/pipeline'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function targetTypeForPurpose(purpose) {
  if (purpose.startsWith('event_')) return 'event'
  if (purpose.startsWith('location_')) return 'location'
  if (purpose === 'host_logo') return 'host'
  if (purpose === 'profile_photo') return 'profile'
  if (purpose === 'chat_image') return 'conversation'
  if (purpose === 'verification_document') return 'verification'
  return null
}

async function attachAsset(supabase, user, asset, purpose, targetId, sortOrder) {
  if (purpose === 'profile_photo') {
    const { error } = await supabase.from('profiles').update({ avatar_path: asset.object_path }).eq('id', user.id)
    if (error) throw error
    return
  }

  if (!targetId) throw new Error('Choose what this upload belongs to.')

  if (purpose === 'event_cover') {
    const { error } = await supabase.from('events').update({ cover_path: asset.object_path }).eq('id', targetId)
    if (error) throw error
  } else if (purpose === 'event_gallery') {
    const { error } = await supabase.from('event_media').insert({ event_id: targetId, media_asset_id: asset.id, sort_order: sortOrder })
    if (error) throw error
  } else if (purpose === 'location_cover') {
    const { error } = await supabase.from('locations').update({ cover_path: asset.object_path }).eq('id', targetId)
    if (error) throw error
  } else if (purpose === 'location_gallery') {
    const { error } = await supabase.from('location_media').insert({ location_id: targetId, media_asset_id: asset.id, sort_order: sortOrder })
    if (error) throw error
  } else if (purpose === 'host_logo') {
    const { error } = await supabase.from('host_profiles').update({ logo_path: asset.object_path }).eq('id', targetId)
    if (error) throw error
  } else if (purpose === 'chat_image') {
    const { data: membership } = await supabase.from('conversation_members').select('conversation_id').eq('conversation_id', targetId).eq('profile_id', user.id).maybeSingle()
    if (!membership) throw new Error('You cannot add media to that conversation.')
  } else if (purpose === 'verification_document') {
    const { error } = await supabase.from('verification_documents').insert({
      profile_id: user.id,
      host_profile_id: targetId || null,
      media_asset_id: asset.id,
      document_kind: 'supporting_document'
    })
    if (error) throw error
  }
}

export async function POST(request) {
  if (!isSupabaseConfigured()) return NextResponse.json({ error: 'Uploads are temporarily unavailable.' }, { status: 503 })
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Sign in to upload media.' }, { status: 401 })

  let form
  try {
    form = await request.formData()
  } catch {
    return NextResponse.json({ error: 'The upload could not be read.' }, { status: 400 })
  }

  const file = form.get('file')
  const purpose = String(form.get('purpose') || '')
  const targetId = String(form.get('target_id') || '').trim() || null
  const sortOrder = Math.max(0, Math.min(999, Number.parseInt(String(form.get('sort_order') || '0'), 10) || 0))

  try {
    const policy = mediaPolicy(purpose)
    if (policy.target !== 'profile' && !targetId && purpose !== 'verification_document') throw new Error('Choose what this upload belongs to.')
    const processed = await processMediaFile(file, purpose)
    const objectPath = mediaObjectPath(user.id, processed.extension)
    const admin = createAdminClient()

    const { error: uploadError } = await admin.storage
      .from(processed.bucket)
      .upload(objectPath, processed.buffer, {
        contentType: processed.mimeType,
        cacheControl: processed.visibility === 'public' ? '31536000' : '3600',
        upsert: false
      })
    if (uploadError) throw uploadError

    const { data: asset, error: assetError } = await admin.from('media_assets').insert({
      owner_id: user.id,
      purpose,
      target_type: targetTypeForPurpose(purpose),
      target_id: targetId,
      bucket_id: processed.bucket,
      object_path: objectPath,
      original_name: processed.originalName,
      mime_type: processed.mimeType,
      bytes: processed.bytes,
      width: processed.width,
      height: processed.height,
      sha256: processed.sha256,
      visibility: processed.visibility,
      status: processed.status,
      scan_status: processed.scanStatus,
      scanner: processed.scanner,
      approved_at: processed.status === 'approved' ? new Date().toISOString() : null
    }).select('*').single()

    if (assetError || !asset) {
      await admin.storage.from(processed.bucket).remove([objectPath])
      throw assetError || new Error('The media record could not be created.')
    }

    try {
      await attachAsset(supabase, user, asset, purpose, targetId, sortOrder)
    } catch (error) {
      await admin.storage.from(processed.bucket).remove([objectPath])
      await admin.from('media_assets').delete().eq('id', asset.id)
      throw error
    }

    let url = null
    if (processed.visibility === 'public') {
      url = admin.storage.from(processed.bucket).getPublicUrl(objectPath).data.publicUrl
    } else {
      const { data } = await admin.storage.from(processed.bucket).createSignedUrl(objectPath, 900)
      url = data?.signedUrl || null
    }

    return NextResponse.json({
      asset: { id: asset.id, purpose, status: asset.status, scanStatus: asset.scan_status, url, width: asset.width, height: asset.height }
    }, { status: 201 })
  } catch (error) {
    const message = String(error?.message || 'The upload failed.')
    return NextResponse.json({ error: /policy|permission|rls/i.test(message) ? 'You do not have permission to attach media there.' : message }, { status: 400 })
  }
}
