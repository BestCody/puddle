import { NextResponse } from 'next/server'
import { getPublicLocationRecommendations } from '@/lib/app/public-content'

export const dynamic = 'force-dynamic'

export async function GET(_request, context) {
  const { slug } = await context.params
  try {
    const items = await getPublicLocationRecommendations(slug)
    return NextResponse.json({ items }, {
      headers: {
        'Cache-Control': 'public, max-age=60, s-maxage=300, stale-while-revalidate=600',
        'CDN-Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600'
      }
    })
  } catch (error) {
    console.error(`Location recommendations failed slug=${String(slug || '')}: ${error?.message || 'unknown error'}`)
    return NextResponse.json(
      { error: 'Location recommendations could not be loaded.' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } }
    )
  }
}
