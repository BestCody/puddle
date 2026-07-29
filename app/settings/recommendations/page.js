import Link from 'next/link'
import { RecommendationSettings } from '@/components/recommendation-settings'
import { renderProductPage } from '@/lib/app/render-product-page'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Recommendation settings' }

export default function RecommendationSettingsPage() {
  return renderProductPage(async (session) => {
    const { data } = await session.supabase.from('recommendation_preferences').select('behavioral_enabled,friend_activity_enabled,vector_enabled,explicit_interests_only').eq('profile_id', session.user.id).maybeSingle()
    const preferences = { behavioral_enabled: true, friend_activity_enabled: true, vector_enabled: true, explicit_interests_only: false, ...(data || {}) }
    return <><section className="page-heading-row"><div><span className="section-pill section-pill-purple">Recommendations</span><h1 className="product-title">Control what shapes your feed.</h1><p>Use transparent signals, reset learned preferences, or remove recommendation data without affecting operational records.</p></div><Link className="splash-button splash-button-mint" href="/discover">Back to Discover</Link></section><RecommendationSettings initialPreferences={preferences} /></>
  })
}
