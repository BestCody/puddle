export const DISCOVERY_IMAGE_SIZES = '(max-width: 760px) 320px, 400px'

const OPTIMIZED_DISCOVERY_IMAGE_HOSTS = new Set(['cegoqtvajwajczbofpep.supabase.co'])

export function canOptimizeDiscoveryImage(url) {
  if (!url) return false
  const value = String(url)
  if (value.startsWith('/')) return true
  try { return OPTIMIZED_DISCOVERY_IMAGE_HOSTS.has(new URL(value).hostname) } catch { return false }
}
