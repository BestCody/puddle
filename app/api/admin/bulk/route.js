import { NextResponse } from 'next/server'
import { requirePrivilegedApi } from '@/lib/auth/privileged'
import { verifyCsrf } from '@/lib/security/csrf'
import { enforceRateLimit } from '@/lib/security/rate-limit'
import { readJsonLimited, safeSecurityError } from '@/lib/security/request'
import { object,string,uuid } from '@/lib/security/schema'
import { recordSecurityEvent } from '@/lib/security/audit'
const OPERATIONS=['notify_attendees','refund_all','cancel_notify','cancel_refund_notify']
export const runtime='nodejs';export const dynamic='force-dynamic'
export async function POST(request){let session;try{if(!verifyCsrf(request))return NextResponse.json({error:'Security token is invalid.'},{status:403});session=await requirePrivilegedApi(['finance_ops','super_admin','incident_commander']);const limited=await enforceRateLimit({headers:request.headers,userId:session.user.id,action:'admin_bulk_operation',weight:5});if(!limited.allowed)return NextResponse.json({error:'Too many bulk operations.'},{status:429});const body=object(await readJsonLimited(request,16_000));const eventId=uuid(body.eventId,'eventId');const operation=string(body.operation,{name:'operation',choices:OPERATIONS,max:40});const reason=string(body.reason,{name:'reason',min:8,max:2000});const{data,error}=await session.supabase.rpc('queue_bulk_event_operation_v1',{target_event:eventId,operation_name:operation,operation_reason:reason,request_id_value:limited.requestId});if(error)throw error;await recordSecurityEvent({headers:request.headers,actorId:session.user.id,eventType:'bulk_event_operation_queued',severity:'high',targetType:'event',targetId:eventId,metadata:{operation}});return NextResponse.json({ok:true,operationId:data})}catch(error){return NextResponse.json({error:safeSecurityError(error,'Bulk operation could not be queued.')},{status:error?.status||400})}}
