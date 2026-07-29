import { MediaUploader } from '@/components/media-uploader'
import { renderProductPage } from '@/lib/app/render-product-page'
import { getCreatorOptions } from '@/lib/app/creator-data'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Profile media' }

export default function ProfileMediaPage() {
  return renderProductPage(async (session) => {
    const options = await getCreatorOptions(session)
    return (
      <>
        <section className="page-heading-row"><div><span className="section-pill section-pill-mint">Identity media</span><h1 className="product-title">Put a face on the plan.</h1><p>Profile photos and host logos use the same validated, re-encoded upload pipeline as event and place artwork.</p></div></section>
        <div className="media-settings-grid">
          <MediaUploader purpose="profile_photo" targetId={session.user.id} />
          {options.hosts.map((host)=><MediaUploader compact purpose="host_logo" targetId={host.id} key={host.id} />)}
          <MediaUploader purpose="verification_document" />
        </div>
      </>
    )
  })
}
