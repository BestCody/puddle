import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
export const dynamic='force-dynamic'
export async function GET(){try{const supabase=await createClient();const{data}=await supabase.rpc('active_system_notices_v1');return NextResponse.json({notices:data||[]},{headers:{'cache-control':'public, max-age=30'}})}catch{return NextResponse.json({notices:[]})}}
