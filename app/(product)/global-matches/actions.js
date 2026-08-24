"use server"

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { requireUser } from '@/lib/auth/user'
import { pathWithMessage } from '@/lib/auth/redirect'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function value(formData, key, max = 1000) {
  return String(formData.get(key) || '').trim().slice(0, max)
}

function identifier(formData, key) {
  const result = value(formData, key, 40)
  return UUID.test(result) ? result : null
}

function globalPath(kind, message) {
  return pathWithMessage('/global-matches', kind, message)
}

async function callGlobalRpc(name, params, successMessage) {
  const session = await requireUser({ onboarding: true })
  const result = await session.supabase.rpc(name, params)
  if (result.error) redirect(globalPath('error', 'That global connection action could not be completed.'))
  revalidatePath('/global-matches')
  redirect(globalPath('success', successMessage))
}

export async function requestGlobalConnection(formData) {
  const targetUser = identifier(formData, 'target_user')
  const targetLocation = identifier(formData, 'target_location')
  const openingMessage = value(formData, 'opening_message', 800)
  const requestedIntentValue = value(formData, 'intent', 16)
  const requestedIntent = ['date', 'hangout', 'either'].includes(requestedIntentValue) ? requestedIntentValue : 'either'
  if (!targetUser || !targetLocation || openingMessage.length < 1) redirect(globalPath('error', 'Add a short message before sending the request.'))
  await callGlobalRpc('request_global_connection_v1', {
    target_user: targetUser,
    target_location: targetLocation,
    opening_message: openingMessage,
    requested_intent: requestedIntent
  }, 'Message request sent.')
}

export async function respondGlobalConnection(formData) {
  const targetThread = identifier(formData, 'thread_id')
  const decisionValue = value(formData, 'decision', 16)
  const decision = ['accepted', 'declined'].includes(decisionValue) ? decisionValue : null
  if (!targetThread || !decision) redirect(globalPath('error', 'That message request is invalid.'))
  await callGlobalRpc('respond_global_connection_v1', { target_thread: targetThread, decision }, decision === 'accepted' ? 'Message request accepted.' : 'Message request declined.')
}

export async function sendGlobalMessage(formData) {
  const targetThread = identifier(formData, 'thread_id')
  const messageBody = value(formData, 'message_body', 1000)
  if (!targetThread || !messageBody) redirect(globalPath('error', 'Write a message before sending.'))
  await callGlobalRpc('send_global_connection_message_v1', { target_thread: targetThread, message_body: messageBody }, 'Message sent.')
}

export async function blockGlobalConnection(formData) {
  const targetUser = identifier(formData, 'target_user')
  if (!targetUser) redirect(globalPath('error', 'That account could not be blocked.'))
  await callGlobalRpc('block_global_connection_v1', { target_user: targetUser }, 'Account blocked.')
}

export async function reportGlobalConnection(formData) {
  const targetUser = identifier(formData, 'target_user')
  const targetThread = identifier(formData, 'thread_id')
  const reasonValue = value(formData, 'reason', 32)
  const reason = ['spam', 'harassment', 'unsafe', 'impersonation', 'other'].includes(reasonValue) ? reasonValue : 'other'
  const details = value(formData, 'details', 1000) || null
  if (!targetUser) redirect(globalPath('error', 'That account could not be reported.'))
  await callGlobalRpc('report_global_connection_v1', {
    target_user: targetUser,
    target_thread: targetThread,
    report_reason: reason,
    report_details: details
  }, 'Report submitted.')
}
