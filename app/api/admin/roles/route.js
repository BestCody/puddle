import { NextResponse } from 'next/server'
import { requirePrivilegedApi } from '@/lib/auth/privileged'
import { verifyCsrf } from '@/lib/security/csrf'
import { enforceRateLimit } from '@/lib/security/rate-limit'
import { readJsonLimited, safeSecurityError } from '@/lib/security/request'
import { boolean, object, string, uuid } from '@/lib/security/schema'
import { recordSecurityEvent } from '@/lib/security/audit'

export const runtime='nodejs';export const dynamic='force-dynamic'
const ROLES=['super_admin','trust_safety','content_moderator','verification','support','finance_ops','security','incident_commander']
export async function POST(request){let session;try{if(!verifyCsrf(request))return NextResponse.json({error:'Security token is invalid.'},{status:403});session=await requirePrivilegedApi(['super_admin','security']);const limited=await enforceRateLimit({headers:request.headers,userId:session.user.id,action:'admin_role_change'});if(!limited.allowed)return NextResponse.json({error:'Too many role changes. Try again later.'},{status:429,headers:{'retry-after':String(limited.retryAfter||60)}});const body=object(await readJsonLimited(request,16_000));const profileId=uuid(body.profileId,'profileId');const role=string(body.role,{name:'role',choices:ROLES,max:40});const enabled=boolean(body.enabled,'enabled');const reason=string(body.reason,{name:'reason',min:8,max:1000});const{error}=await session.supabase.rpc('manage_privileged_role_v1',{target_profile:profileId,role_value:role,enabled,reason_value:reason,request_id_value:limited.requestId});if(error)throw error;await recordSecurityEvent({headers:request.headers,actorId:session.user.id,eventType:enabled?'privileged_role_granted':'privileged_role_revoked',severity:'high',targetType:'profile',targetId:profileId,metadata:{role}});return NextResponse.json({ok:true})}catch(error){return NextResponse.json({error:safeSecurityError(error,'The privileged role could not be changed.')},{status:error?.status||400})}}
