import Link from 'next/link'
import { RecommendationSettings } from '@/components/recommendation-settings'
import { renderProductPage } from '@/lib/app/render-product-page'
import { requiredQuery } from '@/lib/app/required-query'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Recommendation settings' }

export default function RecommendationSettingsPage() {
  return renderProductPage(async (session) => {
    let preferences = null
    try {
      const data = await requiredQuery(session.supabase.from('recommendation_preferences').select('behavioral_enabled,friend_activity_enabled,vector_enabled,explicit_interests_only').eq('profile_id', session.user.id).maybeSingle())
      preferences = { behavioral_enabled: true, friend_activity_enabled: true, vector_enabled: true, explicit_interests_only: false, ...(data || {}) }
    } catch (error) {
      console.error('Recommendation settings failed:', error)
    }
    return <><section className="page-heading-row"><div><span className="section-pill section-pill-purple">Recommendations</span><h1 className="product-title">Control what shapes your feed.</h1><p>Use transparent signals, reset learned preferences, or remove recommendation data without affecting operational records.</p></div><Link className="splash-button splash-button-mint" href="/discover">Back to Discover</Link></section>{preferences ? <RecommendationSettings initialPreferences={preferences} /> : <p role="alert">Recommendation settings could not be loaded. <a href="/settings/recommendations">Try again</a>.</p>}</>
  })
}
