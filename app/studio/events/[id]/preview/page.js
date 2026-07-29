import { PublicEventView } from '@/components/public-listing'
import { requireUser } from '@/lib/auth/user'
import { getEditableEvent } from '@/lib/app/creator-data'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Event preview', robots: { index: false, follow: false } }

export default async function EventPreviewPage({ params }) {
  const { id } = await params
  const session = await requireUser({ onboarding: true })
  const event = await getEditableEvent(session.supabase, id)
  const [locationResult, hostResult] = await Promise.all([
    event.location_id ? session.supabase.from('locations').select('*').eq('id', event.location_id).maybeSingle() : Promise.resolve({ data: null }),
    event.host_profile_id ? session.supabase.from('host_profiles').select('*').eq('id', event.host_profile_id).maybeSingle() : Promise.resolve({ data: null })
  ])
  return <PublicEventView event={{ ...event, location: locationResult.data, host: hostResult.data }} preview />
}
