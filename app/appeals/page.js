import sharedUIStyles from "@/components/shared-ui.module.css"
import { scopedClasses } from "@/components/scoped-classes"
import { renderProductPage } from '@/lib/app/render-product-page'
import { requiredQuery } from '@/lib/app/required-query'
import { AppealForm } from '@/components/appeal-form'
import styles from '@/components/appeal-card.module.css'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Appeals', robots: { index: false, follow: false } }

export default function AppealsPage() {
  return renderProductPage(async (session) => {
    let appeals
    try {
      appeals = await requiredQuery(session.supabase.from('moderation_appeals')
        .select('id,case_id,state,statement,decision_reason,created_at,decided_at,moderation_cases(case_number,title)')
        .eq('appellant_id', session.user.id)
        .order('created_at', { ascending: false }))
      if (!Array.isArray(appeals)) throw new Error('Appeal history returned incomplete data.')
    } catch (error) {
      console.error('Appeal history failed:', error)
      return <section className={styles.card} role="alert"><h1>Appeals unavailable</h1><p>Your appeal history could not be loaded. Please retry before submitting another appeal.</p><a href="/appeals">Try again</a></section>
    }

    return <>
      <div className={scopedClasses(sharedUIStyles, "page-heading-row")}><div><span className="section-pill section-pill-yellow">Appeals</span><h1 className={scopedClasses(sharedUIStyles, "product-title")}>Request another review.</h1><p>Appeals are assigned separately and preserve the original case evidence and audit history.</p></div></div>
      <AppealForm />
      <section className={styles.card}><h2>Your appeals</h2>{appeals.map((item) => <article key={item.id}><strong>{item.moderation_cases?.case_number} · {item.state}</strong><p>{item.statement}</p>{item.decision_reason ? <small>{item.decision_reason}</small> : null}</article>)}</section>
    </>
  })
}
