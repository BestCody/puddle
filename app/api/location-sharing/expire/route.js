import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { verifyWorkerBearer } from '@/lib/security/worker-auth'
export const runtime='nodejs';export const dynamic='force-dynamic'
export async function GET(request){if(!verifyWorkerBearer(request))return NextResponse.json({error:'Unauthorized.'},{status:401});try{const admin=createAdminClient();const{data,error}=await admin.rpc('expire_location_shares_v1',{batch_size:500});if(error)throw error;return NextResponse.json({ok:true,result:data})}catch{return NextResponse.json({error:'Location expiry worker failed.'},{status:500})}}
