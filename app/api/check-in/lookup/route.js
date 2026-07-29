import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isSupabaseConfigured } from '@/lib/supabase/env'
export const dynamic='force-dynamic'
export async function GET(request){if(!isSupabaseConfigured())return NextResponse.json({error:'Lookup is unavailable.'},{status:503});const s=await createClient();const{data:{user}}=await s.auth.getUser();if(!user)return NextResponse.json({error:'Sign in.'},{status:401});const eventId=request.nextUrl.searchParams.get('eventId');const q=String(request.nextUrl.searchParams.get('q')||'').trim().slice(0,120);const{data,error}=await s.rpc('lookup_event_tickets_v1',{target_event:eventId,search_term:q});if(error)return NextResponse.json({error:'Ticket lookup failed.'},{status:400});return NextResponse.json({results:data||[]})}
