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
  const [memberships, locations, categories] = await Promise.all([
    queryOr(supabase.from('host_members').select('role,accepted_at,host_profiles(id,name,slug,kind,verification_status,status)').eq('profile_id', user.id).not('accepted_at', 'is', null)),
    queryOr(supabase.from('locations').select('id,name,slug,city,status').order('name')),
    queryOr(supabase.from('content_categories').select('slug,label,content_kind').eq('active', true).eq('content_kind', 'place').order('sort_order'))
  ])
  const hosts = memberships.map((membership) => membership.host_profiles).filter((host) => host && host.status === 'active')
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

export async function getEditableLocation(supabase, id) {
  const { data: allowed } = await supabase.rpc('can_manage_location', { target: id })
  if (!allowed) notFound()
  const { data, error } = await supabase.from('locations').select('*').eq('id', id).maybeSingle()
  if (error || !data) notFound()
  const [claims, revisions, privateDetails] = await Promise.all([
    queryOr(supabase.from('location_claims').select('id,status,relationship,note,created_at').eq('location_id', id).order('created_at', { ascending: false })),
    queryOr(supabase.from('location_revisions').select('id,revision_no,change_source,note,created_at,actor_id').eq('location_id', id).order('revision_no', { ascending: false }).limit(12)),
    queryOr(supabase.from('location_private_details').select('exact_address').eq('location_id', id).maybeSingle(), null)
  ])
  return { ...data, private_address: privateDetails?.exact_address || '', claims, revisions }
}
