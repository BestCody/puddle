import { notFound } from 'next/navigation'
import { AuthMessage } from '@/components/auth-message'
import { recordLocationVisit } from '@/app/plans/actions'
import { renderProductPage } from '@/lib/app/render-product-page'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Plan a visit' }

export default async function PlanLocationVisitPage({ params, searchParams }) {
  const { slug } = await params
  const messages = await searchParams
  return renderProductPage(async (session) => {
    const { data: location } = await session.supabase.from('locations').select('id,name,slug,summary,city,neighborhood,status').eq('slug',slug).eq('status','published').maybeSingle()
    if (!location) notFound()
    const { data: existing } = await session.supabase.from('location_visits').select('status,planned_for,note').eq('profile_id',session.user.id).eq('location_id',location.id).maybeSingle()
    return <><section className="product-hero product-hero-purple"><div><span className="section-pill section-pill-yellow">Place plan</span><h1>{location.name}</h1><p>{location.summary || `Plan a visit in ${location.neighborhood || location.city}.`}</p></div><div className="create-scribble" aria-hidden="true">save<br/>a day<br/>to go ↗</div></section><AuthMessage searchParams={messages}/><form className="visit-plan-form" action={recordLocationVisit}><input type="hidden" name="location_id" value={location.id}/><label>Status<select name="status" defaultValue={existing?.status || 'planned'}><option value="planned">Plan a visit</option><option value="visited">I already visited</option></select></label><label>Planned time<input name="planned_for" type="datetime-local" defaultValue={existing?.planned_for ? new Date(existing.planned_for).toISOString().slice(0,16) : ''}/></label><label className="span-two">Note<textarea name="note" maxLength={500} defaultValue={existing?.note || ''} placeholder="Try the patio, meet by the entrance, bring a sketchbook…"/><small className="field-hint">500 characters maximum.</small></label><button className="splash-button splash-button-mint" type="submit">Save visit</button></form></>
  })
}
