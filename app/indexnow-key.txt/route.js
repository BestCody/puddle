import { indexNowKey } from '@/lib/seo/indexnow'

// IndexNow verifies ownership by fetching the key back from the host. The submission payload
// points here via keyLocation, so the key never needs a filename-specific static file.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export function GET() {
  const key = indexNowKey()
  if (!key) return new Response('Not found', { status: 404 })
  return new Response(key, {
    status: 200,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=3600' }
  })
}
