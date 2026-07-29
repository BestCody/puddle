import { PublicLocationView } from '@/components/public-listing'
import { requireUser } from '@/lib/auth/user'
import { getEditableLocation } from '@/lib/app/creator-data'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Location preview', robots: { index: false, follow: false } }

export default async function LocationPreviewPage({ params }) {
  const { id } = await params
  const session = await requireUser({ onboarding: true })
  const location = await getEditableLocation(session.supabase, id)
  const hostResult = location.host_profile_id ? await session.supabase.from('host_profiles').select('*').eq('id', location.host_profile_id).maybeSingle() : { data: null }
  return <PublicLocationView location={{ ...location, host: hostResult.data }} preview />
}
