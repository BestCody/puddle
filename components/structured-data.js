import { headers } from 'next/headers'
import { serializeStructuredData } from '@/lib/app/structured-data'

export async function StructuredData({ data }) {
  if (!data) return null
  const nonce = (await headers()).get('x-nonce')
  return <script nonce={nonce || undefined} type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeStructuredData(data) }} />
}
