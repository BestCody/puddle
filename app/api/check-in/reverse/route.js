import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isSupabaseConfigured } from '@/lib/supabase/env'
export async function POST(request){if(!isSupabaseConfigured())return NextResponse.json({error:'Check-in is unavailable.'},{status:503});const s=await createClient();const{data:{user}}=await s.auth.getUser();if(!user)return NextResponse.json({error:'Sign in.'},{status:401});const b=await request.json().catch(()=>({}));const{data,error}=await s.rpc('reverse_ticket_checkin_v1',{target_event:b.eventId,target_checkin:b.checkinId,reversal_reason:String(b.reason||'').slice(0,500)});if(error)return NextResponse.json({error:String(error.message||'Reversal failed.').slice(0,200)},{status:400});return NextResponse.json({ok:true,result:data})}
