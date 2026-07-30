"use server"

import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { requireUser } from '@/lib/auth/user'
import { pathWithMessage, safeNextPath } from '@/lib/auth/redirect'
import { verifyTurnstile } from '@/lib/security/turnstile'
import { enforceRateLimitFromHeaders } from '@/lib/security/rate-limit'

const TARGETS = new Set(['event','location','host','profile','conversation','message','comment','plan','ticket','order','payment'])
function clean(value, max) { return String(value || '').trim().slice(0, max) }

export async function submitContentReport(formData) {
  const session = await requireUser({ onboarding: true })
  const requestHeaders = await headers()
  const targetType = clean(formData.get('target_type'), 40)
  const targetId = clean(formData.get('target_id'), 120)
  const category = clean(formData.get('category'), 80)
  const details = clean(formData.get('details'), 3000)
  const returnTo = safeNextPath(clean(formData.get('return_to'), 500) || '/discover')
  if (!TARGETS.has(targetType) || !targetId || !category) redirect(pathWithMessage('/report', 'error', 'Choose what you are reporting and why.'))
  const limited = await enforceRateLimitFromHeaders({ headers: requestHeaders, userId: session.user.id, action: 'submit_report' })
  if (!limited.allowed) redirect(pathWithMessage('/report', 'error', 'Too many reports were submitted. Try again later.'))
  const turnstile = await verifyTurnstile({ token: clean(formData.get('cf-turnstile-response'), 2048), action: 'submit_report', remoteIp: limited.ip })
  if (!turnstile.success) redirect(pathWithMessage('/report', 'error', 'Please complete the safety check and try again.'))
  const { error } = await session.supabase.rpc('report_social_target_v2', { target_kind: targetType, target_value: targetId, report_category: category, report_details: details || null, risk_context: { request_id: limited.requestId, turnstile: turnstile.outcome } })
  if (error) redirect(pathWithMessage('/report', 'error', 'We could not submit this report. Please try again.'))
  redirect(pathWithMessage(returnTo, 'success', 'Report submitted. Thank you for helping keep Puddle safe and accurate.'))
}
