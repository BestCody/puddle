import { NextResponse } from 'next/server'
import { requirePrivilegedApi } from '@/lib/auth/privileged'
import { verifyCsrf } from '@/lib/security/csrf'
import { enforceRateLimit } from '@/lib/security/rate-limit'
import { readJsonLimited, safeSecurityError } from '@/lib/security/request'
import { object, string, uuid } from '@/lib/security/schema'
import { recordSecurityEvent } from '@/lib/security/audit'

export const runtime='nodejs';export const dynamic='force-dynamic'
export async function POST(request){let session;try{if(!verifyCsrf(request))return NextResponse.json({error:'Security token is invalid.'},{status:403});session=await requirePrivilegedApi(['super_admin','security','incident_commander']);const limited=await enforceRateLimit({headers:request.headers,userId:session.user.id,action:'admin_case_action'});if(!limited.allowed)return NextResponse.json({error:'Too many security actions.'},{status:429});const body=object(await readJsonLimited(request,12_000));const alertId=uuid(body.alertId,'alertId');const action=string(body.action,{name:'action',choices:['acknowledge','investigate','resolve','dismiss'],max:20});const reason=string(body.reason||'',{name:'reason',optional:true,max:1000})||'';const{error}=await session.supabase.rpc('manage_security_alert_v1',{target_alert:alertId,action_value:action,reason_value:reason,request_id_value:limited.requestId});if(error)throw error;await recordSecurityEvent({headers:request.headers,actorId:session.user.id,eventType:`security_alert_${action}`,severity:'notice',targetType:'security_alert',targetId:alertId});return NextResponse.json({ok:true})}catch(error){return NextResponse.json({error:safeSecurityError(error,'The security alert could not be updated.')},{status:error?.status||400})}}
