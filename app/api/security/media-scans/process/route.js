import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { processPendingMediaScans } from '@/lib/security/media-scan-worker'
import { verifyWorkerBearer } from '@/lib/security/worker-auth'
export const runtime='nodejs';export const dynamic='force-dynamic'
export async function POST(request){if(!verifyWorkerBearer(request))return NextResponse.json({error:'Not authorized.'},{status:401});try{const results=await processPendingMediaScans(createAdminClient(),Number(process.env.MEDIA_SCAN_BATCH_SIZE||25));return NextResponse.json({ok:true,results})}catch{return NextResponse.json({error:'Media scan processing failed.'},{status:500})}}
