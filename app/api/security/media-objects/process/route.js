import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { processDeletedMediaObjects } from '@/lib/media/deleted-object-worker'
import { verifyWorkerBearer } from '@/lib/security/worker-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request) {
  if (!verifyWorkerBearer(request)) return NextResponse.json({ error: 'Not authorized.' }, { status: 401 })
  try {
    const results = await processDeletedMediaObjects(createAdminClient(), Number(process.env.MEDIA_CLEANUP_BATCH_SIZE || 25))
    const failed = results.some((item) => !item.ok)
    return NextResponse.json({ ok: !failed, results }, { status: failed ? 503 : 200 })
  } catch {
    return NextResponse.json({ error: 'Media cleanup failed.' }, { status: 503 })
  }
}
