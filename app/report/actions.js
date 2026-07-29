"use server"

import { redirect } from 'next/navigation'
import { requireUser } from '@/lib/auth/user'
import { pathWithMessage, safeNextPath } from '@/lib/auth/redirect'

export async function submitContentReport(formData) {
  const session = await requireUser({ onboarding: true })
  const targetType = String(formData.get('target_type') || '').slice(0, 40)
  const targetId = String(formData.get('target_id') || '').slice(0, 120)
  const category = String(formData.get('category') || '').slice(0, 80)
  const details = String(formData.get('details') || '').trim().slice(0, 3000)
  const returnTo = safeNextPath(String(formData.get('return_to') || '/discover'))
  if (!['event','location','host'].includes(targetType) || !targetId || !category) redirect(pathWithMessage('/report', 'error', 'Choose what you are reporting and why.'))
  const { error } = await session.supabase.from('reports').insert({ reporter_id: session.user.id, target_type: targetType, target_id: targetId, category, details: details || null })
  if (error) redirect(pathWithMessage('/report', 'error', 'We could not submit this report. Please try again.'))
  redirect(pathWithMessage(returnTo, 'success', 'Report submitted. Thank you for helping keep Puddle accurate.'))
}
