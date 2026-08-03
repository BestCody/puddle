import { AuthMessage } from '@/components/auth-message'
import { LocationEditor } from '@/components/location-editor'
import { MediaUploader } from '@/components/media-uploader'
import { renderProductPage } from '@/lib/app/render-product-page'
import { getCreatorOptions, getEditableLocation } from '@/lib/app/creator-data'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Edit location' }

export default async function EditLocationPage({ params, searchParams }) {
  const { id } = await params
  const messages = await searchParams
  return renderProductPage(async (session) => {
    const [location, options] = await Promise.all([
      getEditableLocation(session.supabase, id),
      getCreatorOptions(session)
    ])
    return <>
      <div className="page-heading-row">
        <div>
          <span className="section-pill section-pill-mint">Location studio</span>
          <h1 className="product-title">{location.name}</h1>
          <p>Keep hours, map coordinates, access details, and secure artwork current.</p>
        </div>
      </div>
      <AuthMessage searchParams={messages} />
      <section className="studio-media-grid">
        <MediaUploader purpose="location_cover" targetId={location.id} />
        <MediaUploader purpose="location_gallery" targetId={location.id} multiple />
      </section>
      <LocationEditor location={location} {...options} />
    </>
  })
}
