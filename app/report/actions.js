"use server"

import { redirect } from 'next/navigation'
import { requireUser } from '@/lib/auth/user'
import { pathWithMessage, safeNextPath } from '@/lib/auth/redirect'

const TARGETS = new Set(['event','location','host','profile','conversation','message','comment','plan'])
function clean(value, max) { return String(value || '').trim().slice(0, max) }

export async function submitContentReport(formData) {
  const session = await requireUser({ onboarding: true })
  const targetType = clean(formData.get('target_type'), 40)
  const targetId = clean(formData.get('target_id'), 120)
  const category = clean(formData.get('category'), 80)
  const details = clean(formData.get('details'), 3000)
  const returnTo = safeNextPath(clean(formData.get('return_to'), 500) || '/discover')
  if (!TARGETS.has(targetType) || !targetId || !category) redirect(pathWithMessage('/report', 'error', 'Choose what you are reporting and why.'))
  const { error } = await session.supabase.rpc('report_social_target_v1', { target_kind: targetType, target_value: targetId, report_category: category, report_details: details || null })
  if (error) redirect(pathWithMessage('/report', 'error', 'We could not submit this report. Please try again.'))
  redirect(pathWithMessage(returnTo, 'success', 'Report submitted. Thank you for helping keep Puddle safe and accurate.'))
}
