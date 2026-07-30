import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { verifyCsrf } from '@/lib/security/csrf'
import { enforceRateLimit } from '@/lib/security/rate-limit'
import { readJsonLimited,safeSecurityError } from '@/lib/security/request'
import { object,string } from '@/lib/security/schema'
import { verifyTurnstile } from '@/lib/security/turnstile'
export const runtime='nodejs';export const dynamic='force-dynamic'
export async function POST(request){try{if(!verifyCsrf(request))return NextResponse.json({error:'Security token is invalid.'},{status:403});const supabase=await createClient();const{data:{user}}=await supabase.auth.getUser();if(!user)return NextResponse.json({error:'Sign in to appeal.'},{status:401});const limited=await enforceRateLimit({headers:request.headers,userId:user.id,action:'submit_appeal'});if(!limited.allowed)return NextResponse.json({error:'Too many appeal requests.'},{status:429});const body=object(await readJsonLimited(request,16_000));const turnstile=await verifyTurnstile({token:String(body.turnstileToken||''),action:'submit_appeal',remoteIp:limited.ip});if(!turnstile.success)return NextResponse.json({error:'Complete the safety check before submitting.'},{status:403});const caseNumber=string(body.caseNumber,{name:'case number',min:4,max:32,pattern:/^PDL-[A-Z0-9-]+$/i});const statement=string(body.statement,{name:'statement',min:20,max:5000});const{data,error}=await supabase.rpc('submit_moderation_appeal_v1',{case_number_value:caseNumber,appeal_statement:statement,request_id_value:limited.requestId});if(error)throw error;return NextResponse.json({ok:true,appealId:data})}catch(error){return NextResponse.json({error:safeSecurityError(error,'Appeal could not be submitted.')},{status:error?.status||400})}}
