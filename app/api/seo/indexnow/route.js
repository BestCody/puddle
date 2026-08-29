import { NextResponse } from 'next/server'
import sitemap from '@/app/sitemap'
import { isIndexNowConfigured, submitToIndexNow } from '@/lib/seo/indexnow'
import { verifyWorkerBearer } from '@/lib/security/worker-auth'

// Submits every sitemap URL to IndexNow. Safe to run on a schedule: IndexNow expects
// repeat submissions and treats them as "still current" rather than as spam.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function submit(request) {
  if (!verifyWorkerBearer(request)) return NextResponse.json({ error: 'Not authorized.' }, { status: 401 })
  if (!isIndexNowConfigured()) return NextResponse.json({ error: 'INDEXNOW_KEY is not set.' }, { status: 503 })
  try {
    const urls = sitemap().map((entry) => entry.url)
    const result = await submitToIndexNow(urls)
    return NextResponse.json({ ok: true, ...result })
  } catch {
    return NextResponse.json({ error: 'IndexNow submission failed.' }, { status: 500 })
  }
}

// Vercel Cron invokes scheduled routes with GET and supplies the CRON_SECRET bearer itself.
// POST is kept so the same submission can be triggered by hand.
export const GET = submit
export const POST = submit
