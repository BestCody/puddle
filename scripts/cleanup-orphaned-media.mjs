import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const secretKey = process.env.SUPABASE_SECRET_KEY
if (!url || !secretKey) throw new Error('Supabase URL and secret key are required.')

const supabase = createClient(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } })
const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

const [{ data: abandoned, error: abandonedError }, { data: deleted, error: deletedError }] = await Promise.all([
  supabase.from('media_assets').select('id,bucket_id,object_path,verification_documents(id)').eq('status', 'quarantined').lt('created_at', cutoff).limit(500),
  supabase.from('media_assets').select('id,bucket_id,object_path').not('deleted_at', 'is', null).limit(500)
])
if (abandonedError || deletedError) throw abandonedError || deletedError

const orphaned = (abandoned || []).filter((asset) => !(asset.verification_documents || []).length)
const assets = [...new Map([...orphaned, ...(deleted || [])].map((asset) => [asset.id, asset])).values()]
for (const asset of assets) {
  const { error: removeError } = await supabase.storage.from(asset.bucket_id).remove([asset.object_path])
  if (removeError) {
    console.error(`Could not remove ${asset.bucket_id}/${asset.object_path}: ${removeError.message}`)
    continue
  }
  const { error: rowError } = await supabase.from('media_assets').delete().eq('id', asset.id)
  if (rowError) console.error(`Could not delete media row ${asset.id}: ${rowError.message}`)
}
console.log(`Processed ${assets.length} abandoned or deleted media assets.`)
