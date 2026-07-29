import { notFound } from 'next/navigation'

async function queryOr(query, fallback = []) {
  try {
    const { data, error } = await query
    if (error) return fallback
    return data ?? fallback
  } catch {
    return fallback
  }
}

export async function getCreatorOptions({ supabase, user, profile }) {
  const [hosts, locations, categories] = await Promise.all([
    queryOr(supabase.from('host_profiles').select('id,name,slug,kind,verification_status').order('name')),
    queryOr(supabase.from('locations').select('id,name,slug,city,status').order('name')),
    queryOr(supabase.from('content_categories').select('slug,label,content_kind').eq('active', true).order('sort_order'))
  ])

  return {
    identities: [
      { id: '', name: profile?.display_name || user.email || 'Personal profile', kind: 'personal' },
      ...hosts.map((host) => ({ id: host.id, name: host.name, kind: host.kind }))
    ],
    hosts,
    locations,
    categories
  }
}

export async function getEditableEvent(supabase, id) {
  const { data, error } = await supabase.from('events').select('*').eq('id', id).maybeSingle()
  if (error || !data) notFound()
  const [occurrences, revisions] = await Promise.all([
    queryOr(supabase.from('event_occurrences').select('*').eq('event_id', id).order('starts_at')),
    queryOr(supabase.from('event_revisions').select('id,revision_no,change_source,note,created_at,actor_id').eq('event_id', id).order('revision_no', { ascending: false }).limit(12))
  ])
  return { ...data, occurrences, revisions }
}

export async function getEditableLocation(supabase, id) {
  const { data, error } = await supabase.from('locations').select('*').eq('id', id).maybeSingle()
  if (error || !data) notFound()
  const [claims, revisions] = await Promise.all([
    queryOr(supabase.from('location_claims').select('id,status,relationship,note,created_at').eq('location_id', id).order('created_at', { ascending: false })),
    queryOr(supabase.from('location_revisions').select('id,revision_no,change_source,note,created_at,actor_id').eq('location_id', id).order('revision_no', { ascending: false }).limit(12))
  ])
  return { ...data, claims, revisions }
}
