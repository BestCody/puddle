import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { processPendingStripeWebhooks } from '@/lib/stripe/webhooks'
import { verifyWorkerBearer } from '@/lib/security/worker-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request) {
  if (!verifyWorkerBearer(request)) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
  try {
    const batchSize = Number(process.env.STRIPE_WEBHOOK_BATCH_SIZE || 25)
    const results = await processPendingStripeWebhooks(createAdminClient(), batchSize)
    return NextResponse.json({ ok: true, results })
  } catch {
    return NextResponse.json({ error: 'Stripe webhook processing failed.' }, { status: 500 })
  }
}
