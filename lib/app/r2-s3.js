// Temporary compatibility name used by the open-photo importer.
// The legacy R2/B2 object-store runtime is retired; approved photos use Supabase public media.
export function r2Configuration(env = process.env) {
  const supabaseUrl = String(env.NEXT_PUBLIC_SUPABASE_URL || '').trim().replace(/\/+$/, '')
  if (!/^https:\/\//i.test(supabaseUrl)) return null
  return {
    storageBackend: 'supabase',
    publicBaseUrl: `${supabaseUrl}/storage/v1/object/public/puddle-public-media`
  }
}
