import { NextResponse } from 'next/server'
import { requirePrivilegedApi } from '@/lib/auth/privileged'
import { verifyCsrf } from '@/lib/security/csrf'
import { enforceRateLimit } from '@/lib/security/rate-limit'
import { readJsonLimited, safeSecurityError } from '@/lib/security/request'
import { boolean, object, record, string } from '@/lib/security/schema'
import { recordSecurityEvent } from '@/lib/security/audit'

export const runtime='nodejs';export const dynamic='force-dynamic'
export async function POST(request){let session;try{if(!verifyCsrf(request))return NextResponse.json({error:'Security token is invalid.'},{status:403});session=await requirePrivilegedApi(['super_admin','security','incident_commander']);const limited=await enforceRateLimit({headers:request.headers,userId:session.user.id,action:'admin_notice_change'});if(!limited.allowed)return NextResponse.json({error:'Too many configuration changes.'},{status:429});const body=object(await readJsonLimited(request,20_000));const key=string(body.key,{name:'key',min:3,max:80,pattern:/^[a-z0-9_]+$/});const enabled=boolean(body.enabled,'enabled');const config=record(body.config||{},{name:'config',maxBytes:12_000});const reason=string(body.reason,{name:'reason',min:8,max:1000});const{error}=await session.supabase.rpc('set_feature_flag_v1',{flag_key_value:key,enabled_value:enabled,config_value:config,reason_value:reason,request_id_value:limited.requestId});if(error)throw error;await recordSecurityEvent({headers:request.headers,actorId:session.user.id,eventType:'feature_flag_changed',severity:'high',targetType:'feature_flag',targetId:key,metadata:{enabled}});return NextResponse.json({ok:true})}catch(error){return NextResponse.json({error:safeSecurityError(error,'The feature flag could not be changed.')},{status:error?.status||400})}}
