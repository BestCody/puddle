import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isSupabaseConfigured } from '@/lib/supabase/env'
export const dynamic='force-dynamic'
export async function GET(_request,{params}){if(!isSupabaseConfigured())return NextResponse.json({error:'Order status is unavailable.'},{status:503});const{id}=await params;const s=await createClient();const{data:{user}}=await s.auth.getUser();if(!user)return NextResponse.json({error:'Sign in.'},{status:401});const{data,error}=await s.from('orders').select('id,status,event_id,amount_total_cents,currency,paid_at,events(title,slug)').eq('id',id).eq('buyer_id',user.id).maybeSingle();if(error||!data)return NextResponse.json({error:'Order not found.'},{status:404});return NextResponse.json({order:data})}
