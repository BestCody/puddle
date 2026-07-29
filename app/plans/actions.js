"use server"

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { requireUser } from '@/lib/auth/user'
import { pathWithMessage, safeNextPath } from '@/lib/auth/redirect'

function value(formData, name, max = 2000) {
  return String(formData.get(name) || '').trim().slice(0, max)
}

function optionalNumber(input, min, max) {
  if (input === '' || input === null || input === undefined) return null
  const parsed = Number(input)
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : null
}

function optionalDate(value) {
  if (!value) return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}

function publicMessage(error, fallback) {
  const message = String(error?.message || '')
  return message && !/policy|permission|rls|schema|relation|supabase/i.test(message) ? message : fallback
}

export async function createCollaborativePlan(formData) {
  const session = await requireUser({ onboarding: true })
  const title = value(formData, 'title', 120)
  if (title.length < 2) redirect(pathWithMessage('/plans?tab=shared', 'error', 'Give the plan a name.'))
  const startsAt = optionalDate(value(formData, 'starts_at', 80))
  const endsAt = optionalDate(value(formData, 'ends_at', 80))
  const { data, error } = await session.supabase.from('plans').insert({
    owner_id: session.user.id,
    title,
    description: value(formData, 'description', 2000) || null,
    city: value(formData, 'city', 120) || session.profile.city || null,
    starts_at: startsAt,
    ends_at: endsAt,
    timezone: value(formData, 'timezone', 80) || 'America/Toronto',
    visibility: ['private','friends','invite_only'].includes(value(formData, 'visibility', 30)) ? value(formData, 'visibility', 30) : 'invite_only',
    status: 'draft',
    meeting_label: value(formData, 'meeting_label', 300) || null,
    meeting_latitude: optionalNumber(value(formData, 'meeting_latitude', 40), -90, 90),
    meeting_longitude: optionalNumber(value(formData, 'meeting_longitude', 40), -180, 180)
  }).select('id').single()
  if (error || !data) redirect(pathWithMessage('/plans?tab=shared', 'error', publicMessage(error, 'The shared plan could not be created.')))
  redirect(pathWithMessage(`/plans/${data.id}`, 'success', 'Shared plan created. Invite friends and add stops.'))
}

export async function invitePlanMember(formData) {
  const session = await requireUser({ onboarding: true })
  const planId = value(formData, 'plan_id', 64)
  const username = value(formData, 'username', 30).toLowerCase().replace(/^@/, '')
  const next = safeNextPath(value(formData, 'next', 300) || `/plans/${planId}`)
  const { data: profile } = await session.supabase.from('profiles').select('id').eq('username', username).maybeSingle()
  if (!profile) redirect(pathWithMessage(next, 'error', 'No Puddle user has that username.'))
  if (profile.id === session.user.id) redirect(pathWithMessage(next, 'error', 'You are already part of this plan.'))
  const { data: friendship } = await session.supabase.from('friendships').select('state').eq('state','accepted').or(`and(requester_id.eq.${session.user.id},addressee_id.eq.${profile.id}),and(requester_id.eq.${profile.id},addressee_id.eq.${session.user.id})`).maybeSingle()
  if (!friendship) redirect(pathWithMessage(next, 'error', 'Add this person as a friend before inviting them to a plan.'))
  const { error } = await session.supabase.from('plan_members').upsert({
    plan_id: planId,
    profile_id: profile.id,
    role: 'member',
    status: 'invited',
    invited_by: session.user.id
  }, { onConflict: 'plan_id,profile_id' })
  if (error) redirect(pathWithMessage(next, 'error', publicMessage(error, 'That friend could not be invited.')))
  revalidatePath(next)
  redirect(pathWithMessage(next, 'success', `Invitation sent to @${username}.`))
}

export async function respondToPlanInvitation(formData) {
  const session = await requireUser({ onboarding: true })
  const planId = value(formData, 'plan_id', 64)
  const response = value(formData, 'response', 20) === 'accepted' ? 'accepted' : 'declined'
  const { error } = await session.supabase.rpc('respond_plan_invitation_v1', { target: planId, response })
  if (error) redirect(pathWithMessage('/plans?tab=shared', 'error', 'The invitation response could not be saved.'))
  redirect(pathWithMessage(response === 'accepted' ? `/plans/${planId}` : '/plans?tab=shared', 'success', response === 'accepted' ? 'You joined the plan.' : 'Invitation declined.'))
}

export async function addPlanAvailability(formData) {
  const session = await requireUser({ onboarding: true })
  const planId = value(formData, 'plan_id', 64)
  const startsAt = optionalDate(value(formData, 'starts_at', 80))
  const endsAt = optionalDate(value(formData, 'ends_at', 80))
  if (!startsAt || !endsAt || new Date(endsAt) <= new Date(startsAt)) redirect(pathWithMessage(`/plans/${planId}`, 'error', 'Add a valid availability window.'))
  const { error } = await session.supabase.from('plan_availability').insert({
    plan_id: planId,
    profile_id: session.user.id,
    starts_at: startsAt,
    ends_at: endsAt,
    note: value(formData, 'note', 300) || null
  })
  if (error) redirect(pathWithMessage(`/plans/${planId}`, 'error', publicMessage(error, 'Availability could not be added.')))
  revalidatePath(`/plans/${planId}`)
  redirect(pathWithMessage(`/plans/${planId}`, 'success', 'Availability added.'))
}

export async function addPlanStop(formData) {
  const session = await requireUser({ onboarding: true })
  const planId = value(formData, 'plan_id', 64)
  const kind = value(formData, 'kind', 20)
  const targetId = value(formData, 'target_id', 64)
  const { error } = await session.supabase.rpc('add_plan_stop_v1', {
    target_plan: planId,
    target_kind: kind,
    target_id: targetId,
    planned_time: optionalDate(value(formData, 'planned_for', 80)),
    stop_note: value(formData, 'note', 1000) || null
  })
  if (error) redirect(pathWithMessage(`/plans/${planId}`, 'error', publicMessage(error, 'That stop could not be added.')))
  revalidatePath(`/plans/${planId}`)
  redirect(pathWithMessage(`/plans/${planId}`, 'success', 'Stop added to the itinerary.'))
}

export async function createPlanPoll(formData) {
  const session = await requireUser({ onboarding: true })
  const planId = value(formData, 'plan_id', 64)
  const question = value(formData, 'question', 300)
  const labels = value(formData, 'options', 2000).split(/\n|,/).map((item) => item.trim()).filter(Boolean).slice(0, 12)
  const candidateRefs = formData.getAll('candidate').map((item) => String(item)).slice(0, 12)
  const options = []
  for (const reference of candidateRefs) {
    const [kind, id] = reference.split(':')
    if (!['event','place'].includes(kind) || !/^[0-9a-f-]{36}$/i.test(id || '')) continue
    options.push(kind === 'event' ? { event_id: id } : { location_id: id })
  }
  for (const label of labels) options.push({ label: label.slice(0, 300) })
  const unique = [...new Map(options.map((option) => [option.event_id ? `event:${option.event_id}` : option.location_id ? `place:${option.location_id}` : `label:${option.label.toLowerCase()}`, option])).values()].slice(0, 12)
  if (question.length < 2 || unique.length < 2) redirect(pathWithMessage(`/plans/${planId}`, 'error', 'Add a poll question and at least two events, places, or custom options.'))
  const { data: poll, error } = await session.supabase.from('plan_polls').insert({
    plan_id: planId,
    question,
    status: 'open',
    closes_at: optionalDate(value(formData, 'closes_at', 80)),
    created_by: session.user.id
  }).select('id').single()
  if (error || !poll) redirect(pathWithMessage(`/plans/${planId}`, 'error', publicMessage(error, 'The poll could not be created.')))
  const { error: optionsError } = await session.supabase.from('plan_poll_options').insert(unique.map((option, index) => ({ poll_id: poll.id, ...option, sort_order: index })))
  if (optionsError) {
    await session.supabase.from('plan_polls').delete().eq('id', poll.id)
    redirect(pathWithMessage(`/plans/${planId}`, 'error', 'The poll options could not be created.'))
  }
  revalidatePath(`/plans/${planId}`)
  redirect(pathWithMessage(`/plans/${planId}`, 'success', 'Poll opened.'))
}

export async function voteInPlanPoll(formData) {
  const session = await requireUser({ onboarding: true })
  const planId = value(formData, 'plan_id', 64)
  const optionId = value(formData, 'option_id', 64)
  const choice = ['yes','maybe','no'].includes(value(formData, 'choice', 20)) ? value(formData, 'choice', 20) : 'yes'
  const { error } = await session.supabase.from('plan_votes').upsert({
    option_id: optionId,
    profile_id: session.user.id,
    choice
  }, { onConflict: 'option_id,profile_id' })
  if (error) redirect(pathWithMessage(`/plans/${planId}`, 'error', 'Your vote could not be saved.'))
  revalidatePath(`/plans/${planId}`)
  redirect(`/plans/${planId}`)
}

export async function postPlanMessage(formData) {
  const session = await requireUser({ onboarding: true })
  const planId = value(formData, 'plan_id', 64)
  const body = value(formData, 'body', 2000)
  if (!body) redirect(`/plans/${planId}`)
  const { error } = await session.supabase.from('plan_messages').insert({ plan_id: planId, sender_id: session.user.id, body })
  if (error) redirect(pathWithMessage(`/plans/${planId}`, 'error', 'Message could not be sent.'))
  revalidatePath(`/plans/${planId}`)
  redirect(`/plans/${planId}#chat`)
}

export async function requestEventAttendance(formData) {
  const session = await requireUser({ onboarding: true })
  const eventId = value(formData, 'event_id', 64)
  const slug = value(formData, 'slug', 120)
  const answers = {}
  for (const [name, raw] of formData.entries()) {
    if (!name.startsWith('answer_')) continue
    const answer = String(raw || '').trim().slice(0, 1000)
    if (answer) answers[name.slice(7)] = answer
  }
  const visibility = value(formData, 'visibility', 30)
  const guests = Math.max(1, Math.min(10, Number.parseInt(value(formData, 'guest_count', 3), 10) || 1))
  const { data, error } = await session.supabase.rpc('request_event_attendance_v1', {
    target: eventId,
    attendee_answers: answers,
    attendee_visibility: visibility,
    requested_guests: guests
  })
  if (error) redirect(pathWithMessage(`/events/${slug}/join`, 'error', publicMessage(error, 'Your RSVP could not be saved.')))
  revalidatePath('/plans')
  const status = data?.status || 'going'
  redirect(pathWithMessage('/plans?tab=going', 'success', status === 'going' ? 'You are going.' : status === 'waitlisted' ? 'You joined the waitlist.' : 'Your attendance request was sent.'))
}

export async function cancelEventAttendance(formData) {
  const session = await requireUser({ onboarding: true })
  const eventId = value(formData, 'event_id', 64)
  const next = safeNextPath(value(formData, 'next', 300) || '/plans?tab=going')
  const { error } = await session.supabase.rpc('cancel_event_attendance_v1', { target: eventId })
  if (error) redirect(pathWithMessage(next, 'error', 'The RSVP could not be cancelled.'))
  revalidatePath('/plans')
  redirect(pathWithMessage(next, 'success', 'RSVP cancelled.'))
}

export async function approveEventAttendance(formData) {
  const session = await requireUser({ onboarding: true })
  const eventId = value(formData, 'event_id', 64)
  const attendeeId = value(formData, 'attendee_id', 64)
  const approve = value(formData, 'decision', 20) !== 'decline'
  const { error } = await session.supabase.rpc('approve_event_attendance_v1', { target: eventId, attendee: attendeeId, approve })
  if (error) redirect(pathWithMessage(`/studio/events/${eventId}/attendees`, 'error', publicMessage(error, 'The attendance request could not be updated.')))
  revalidatePath(`/studio/events/${eventId}/attendees`)
  redirect(pathWithMessage(`/studio/events/${eventId}/attendees`, 'success', approve ? 'Attendance approved.' : 'Attendance declined.'))
}

export async function promoteEventWaitlist(formData) {
  const session = await requireUser({ onboarding: true })
  const eventId = value(formData, 'event_id', 64)
  const { data, error } = await session.supabase.rpc('promote_event_waitlist_as_manager_v1', { target: eventId })
  if (error) redirect(pathWithMessage(`/studio/events/${eventId}/attendees`, 'error', publicMessage(error, 'The waitlist could not be promoted.')))
  revalidatePath(`/studio/events/${eventId}/attendees`)
  redirect(pathWithMessage(`/studio/events/${eventId}/attendees`, 'success', data ? 'The next eligible person was promoted.' : 'No one currently fits the available capacity.'))
}

export async function checkInAttendee(formData) {
  const session = await requireUser({ onboarding: true })
  const eventId = value(formData, 'event_id', 64)
  const attendeeId = value(formData, 'attendee_id', 64)
  const { error } = await session.supabase.rpc('check_in_attendee_v1', { target: eventId, attendee: attendeeId, checkin_source: 'manual' })
  if (error) redirect(pathWithMessage(`/studio/events/${eventId}/attendees`, 'error', publicMessage(error, 'The attendee could not be checked in.')))
  revalidatePath(`/studio/events/${eventId}/attendees`)
  redirect(pathWithMessage(`/studio/events/${eventId}/attendees`, 'success', 'Attendee checked in.'))
}

export async function recordLocationVisit(formData) {
  const session = await requireUser({ onboarding: true })
  const locationId = value(formData, 'location_id', 64)
  const status = value(formData, 'status', 20) === 'visited' ? 'visited' : 'planned'
  const plannedFor = optionalDate(value(formData, 'planned_for', 80))
  const { error } = await session.supabase.from('location_visits').upsert({
    profile_id: session.user.id,
    location_id: locationId,
    status,
    planned_for: status === 'planned' ? plannedFor : null,
    visited_at: status === 'visited' ? new Date().toISOString() : null,
    note: value(formData, 'note', 500) || null,
    updated_at: new Date().toISOString()
  }, { onConflict: 'profile_id,location_id' })
  if (error) redirect(pathWithMessage('/plans?tab=past', 'error', 'The place visit could not be saved.'))
  revalidatePath('/plans')
  redirect(pathWithMessage(status === 'visited' ? '/plans?tab=past' : '/plans?tab=saved_places', 'success', status === 'visited' ? 'Visit recorded.' : 'Place added to your visit plans.'))
}
