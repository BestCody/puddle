import { AuthMessage } from '@/components/auth-message'
import { EventEditor } from '@/components/event-editor'
import { renderProductPage } from '@/lib/app/render-product-page'
import { getCreatorOptions } from '@/lib/app/creator-data'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Create event' }

export default async function CreateEventPage({ searchParams }) {
  const params = await searchParams
  return renderProductPage(async (session) => {
    const options = await getCreatorOptions(session)
    return <><div className="page-heading-row"><div><span className="section-pill section-pill-yellow">New event</span><h1 className="product-title">Build the whole plan.</h1><p>Your draft autosaves once the title and schedule basics are valid.</p></div></div><AuthMessage searchParams={params} /><EventEditor {...options} /></>
  })
}
