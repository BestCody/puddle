import { createAdminClient } from '@/lib/supabase/admin'
import { requestContext } from './request'

export async function enforceRateLimit({ headers, userId = null, action, hostId = null, weight = 1 }) {
  const context = requestContext(headers)
  try {
    const admin = createAdminClient()
    const { data, error } = await admin.rpc('consume_security_rate_limit_v1', {
      actor_id_value: userId,
      action_name_value: String(action).slice(0, 100),
      ip_hash_value: context.ipHash,
      device_hash_value: context.deviceHash,
      host_id_value: hostId,
      request_weight: Math.max(1, Math.min(100, Number(weight) || 1)),
      request_id_value: context.requestId
    })
    if (error) throw error
    return { ...context, allowed: data?.allowed !== false, retryAfter: Number(data?.retry_after || 0), limits: data?.limits || [] }
  } catch {
    const failOpen = String(process.env.RATE_LIMIT_FAIL_OPEN || '').toLowerCase() === 'true'
    return { ...context, allowed: failOpen, retryAfter: failOpen ? 0 : 60, limits: [], unavailable: true }
  }
}

export function enforceRateLimitFromHeaders(args) { return enforceRateLimit(args) }
