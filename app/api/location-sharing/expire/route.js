import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
export const runtime='nodejs';export const dynamic='force-dynamic'
export async function GET(request){const secret=process.env.CRON_SECRET;if(!secret||request.headers.get('authorization')!==`Bearer ${secret}`)return NextResponse.json({error:'Unauthorized.'},{status:401});try{const admin=createAdminClient();const{data,error}=await admin.rpc('expire_location_shares_v1',{batch_size:500});if(error)throw error;return NextResponse.json({ok:true,result:data})}catch{return NextResponse.json({error:'Location expiry worker failed.'},{status:500})}}
