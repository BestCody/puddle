import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { processPendingStripeWebhooks } from '@/lib/stripe/webhooks'

export const runtime='nodejs'; export const dynamic='force-dynamic'
export async function POST(request) {
  const secret=process.env.CRON_SECRET
  if(!secret||request.headers.get('authorization')!==`Bearer ${secret}`) return NextResponse.json({error:'Unauthorized.'},{status:401})
  try { const results=await processPendingStripeWebhooks(createAdminClient(),50); return NextResponse.json({ok:true,results}) } catch { return NextResponse.json({error:'Stripe webhook worker failed.'},{status:500}) }
}
