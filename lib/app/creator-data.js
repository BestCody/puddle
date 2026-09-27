import { notFound } from 'next/navigation'
import { requiredQuery } from './required-query.js'

export async function getCreatorOptions({ supabase, user, profile }) {
  const memberships = await requiredQuery(supabase.from('host_members')
    .select('host_profiles(id,name,kind,status)')
    .eq('profile_id', user.id)
    .not('accepted_at', 'is', null))
  const hosts = memberships.map((membership) => membership.host_profiles).filter((host) => host && host.status === 'active')
  return {
    identities: [
      { id: '', name: profile?.display_name || user.email || 'Personal profile', kind: 'personal' },
      ...hosts.map((host) => ({ id: host.id, name: host.name, kind: host.kind }))
    ],
    hosts
  }
}

export async function getEditableLocation(supabase, id) {
  const allowed = await requiredQuery(supabase.rpc('can_manage_location', { target: id }))
  if (!allowed) notFound()
  const [data, revisions, privateDetails] = await Promise.all([
    requiredQuery(supabase.from('location_submissions').select('*').eq('id', id).maybeSingle()),
    requiredQuery(supabase.from('location_revisions').select('id,revision_no,change_source,note,created_at,actor_id').eq('location_id', id).order('revision_no', { ascending: false }).limit(12)),
    requiredQuery(supabase.from('location_private_details').select('exact_address').eq('location_id', id).maybeSingle())
  ])
  if (!data) notFound()
  return { ...data, private_address: privateDetails?.exact_address || '', revisions }
}
