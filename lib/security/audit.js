import { createAdminClient } from '@/lib/supabase/admin'
import { requestContext } from './request'

export async function recordSecurityEvent({ headers, actorId = null, eventType, severity = 'info', targetType = null, targetId = null, metadata = {} }) {
  try {
    const context = requestContext(headers)
    const admin = createAdminClient()
    await admin.rpc('record_security_event_v1', {
      actor_id_value: actorId,
      event_type_value: String(eventType).slice(0, 120),
      severity_value: String(severity).slice(0, 20),
      target_type_value: targetType,
      target_id_value: targetId ? String(targetId).slice(0, 160) : null,
      request_id_value: context.requestId,
      ip_hash_value: context.ipHash,
      device_hash_value: context.deviceHash,
      user_agent_hash_value: context.userAgentHash,
      event_metadata: metadata
    })
  } catch {}
}
