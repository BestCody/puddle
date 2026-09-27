import { requiredQuery } from './required-query.js'

export async function getAdminDashboard(supabase) {
  const data = await requiredQuery(supabase.rpc('admin_dashboard_v1'))
  if (!data) throw new Error('Admin dashboard is unavailable.')
  return data
}

export async function getModerationCases(supabase, filters = {}) {
  let query = supabase.from('moderation_cases')
    .select('id,case_number,title,category,priority,state,queue_key,subject_type,subject_id,assigned_to,sla_due_at,emergency_escalated_at,created_at,updated_at,assignee:profiles!moderation_cases_assigned_to_fkey(display_name,username)')
    .order('priority_rank').order('created_at').limit(100)
  if (filters.state) query = query.eq('state', filters.state)
  if (filters.queue) query = query.eq('queue_key', filters.queue)
  return requiredQuery(query)
}

export async function getModerationCase(supabase, id) {
  const item = await requiredQuery(supabase.from('moderation_cases')
    .select('*,assignee:profiles!moderation_cases_assigned_to_fkey(id,display_name,username),reporter:profiles!moderation_cases_reporter_id_fkey(id,display_name,username)')
    .eq('id', id).maybeSingle())
  if (!item) return null
  const [evidence, actions, appeals] = await Promise.all([
    requiredQuery(supabase.from('moderation_case_evidence').select('*').eq('case_id', id).order('preserved_at')),
    requiredQuery(supabase.from('moderation_actions').select('*,actor:profiles!moderation_actions_actor_id_fkey(display_name,username)').eq('case_id', id).order('created_at', { ascending: false })),
    requiredQuery(supabase.from('moderation_appeals').select('*').eq('case_id', id).order('created_at', { ascending: false }))
  ])
  return { case: item, evidence, actions, appeals }
}

export async function getUserModeration(supabase, id) {
  const profile = await requiredQuery(supabase.from('profiles')
    .select('id,display_name,username,role,created_at,suspended_at,banned_at,ban_reason,moderation_state,risk_score')
    .eq('id', id).maybeSingle())
  if (!profile) return null
  const [cases, signals, events] = await Promise.all([
    requiredQuery(supabase.from('moderation_cases').select('id,case_number,title,priority,state,created_at').eq('subject_type', 'profile').eq('subject_id', id).order('created_at', { ascending: false })),
    requiredQuery(supabase.from('abuse_risk_signals').select('*').eq('profile_id', id).order('created_at', { ascending: false })),
    requiredQuery(supabase.from('security_events').select('event_type,severity,created_at,metadata').eq('actor_id', id).order('created_at', { ascending: false }).limit(50))
  ])
  return { profile, cases, signals, events }
}
