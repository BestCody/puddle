import sharedUIStyles from "@/components/shared-ui.module.css"
import { scopedClasses } from "@/components/scoped-classes"
import { AuthMessage } from '@/components/auth-message'
import { renderProductPage } from '@/lib/app/render-product-page'
import { ReportForm } from './report-form'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Report', robots: { index: false, follow: false } }

export default async function ReportPage({ searchParams }) {
  const params = await searchParams
  const target = String(params?.target_type || '').replaceAll('_',' ')
  return renderProductPage(async () => <>
    <div className={scopedClasses(sharedUIStyles, "page-heading-row")}><div>
      <span className="section-pill section-pill-yellow">Safety & accuracy</span>
      <h1 className={scopedClasses(sharedUIStyles, "product-title")}>Report {target || 'something'}.</h1>
      <p>Report posts, listings, profiles, conversations, messages, comments, or shared plans. Evidence is preserved for moderators.</p>
    </div></div>
    <AuthMessage searchParams={params} />
    <ReportForm context={{ target_type: params?.target_type || '', target_id: params?.target_id || '', return_to: params?.return_to || '/discover' }} />
  </>)
}
