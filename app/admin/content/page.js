import { requirePrivileged } from '@/lib/auth/privileged'
import { AdminShell } from '@/components/admin-shell'
import { OpenModerationCase } from '@/components/open-moderation-case'
import { requiredQuery } from '@/lib/app/required-query'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Content review', robots: { index: false, follow: false } }

export default async function ContentPage() {
  const session = await requirePrivileged(['content_moderator', 'verification', 'trust_safety', 'super_admin'])
  let data
  try {
    data = await requiredQuery(session.supabase.rpc('admin_content_review_queue_v1'))
    if (!data || !Array.isArray(data.content) || !Array.isArray(data.verification) || !Array.isArray(data.media)) {
      throw new Error('Content review queue returned incomplete data.')
    }
  } catch (error) {
    console.error('Content review queue failed:', error)
    return <AdminShell access={session.access}><section className="admin-card" role="alert"><h2>Content review unavailable</h2><p>The review queue could not be loaded. No cases have been cleared.</p><a href="/admin/content">Try again</a></section></AdminShell>
  }
  const content = data.content
  const verification = data.verification

  return (
    <AdminShell access={session.access}>
      <div className="admin-grid">
        <section className="admin-card">
          <h2>Content review</h2>
          {content.map((item) => (
            <article key={`${item.subject_type}-${item.subject_id}`}>
              <p><strong>{item.title}</strong> · {item.subject_type} · {item.reason}</p>
              <OpenModerationCase compact subjectType={item.subject_type} subjectId={item.subject_id} title={`Review ${item.title}`} queue="content" category="safety" />
            </article>
          ))}
          {!content.length ? <p>No content needs review.</p> : null}
        </section>

        <section className="admin-card">
          <h2>Claims and verification</h2>
          {verification.map((item) => (
            <article key={`${item.subject_type}-${item.subject_id}`}>
              <p><strong>{item.title}</strong> · {item.subject_type} · {item.state}</p>
              <OpenModerationCase compact subjectType={item.subject_type} subjectId={item.subject_id} title={`Verify ${item.title}`} queue="verification" category="verification" />
            </article>
          ))}
          {!verification.length ? <p>No claims or verification documents need review.</p> : null}
        </section>

        <section className="admin-card">
          <h2>Media scanning</h2>
          {data.media.map((item) => (
            <article key={item.id}>
              <p>{item.original_name} · {item.scan_status}</p>
              <OpenModerationCase compact subjectType="media" subjectId={item.id} title={`Review upload ${item.original_name}`} queue="verification" category="safety" />
            </article>
          ))}
        </section>
      </div>
    </AdminShell>
  )
}
