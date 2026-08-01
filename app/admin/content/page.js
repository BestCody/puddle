import { requirePrivileged } from '@/lib/auth/privileged'
import { AdminShell } from '@/components/admin-shell'
import { OpenModerationCase } from '@/components/open-moderation-case'
import { legacySystemsEnabled } from '@/lib/product-vision'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Content review', robots: { index: false, follow: false } }

export default async function ContentPage() {
  const session = await requirePrivileged(['content_moderator', 'verification', 'trust_safety', 'super_admin'])
  const { data } = await session.supabase.rpc('admin_content_review_queue_v1')
  const showLegacy = legacySystemsEnabled()
  const content = (data?.content || []).filter((item) => showLegacy || item.subject_type !== 'event')
  const verification = (data?.verification || []).filter((item) => showLegacy || item.subject_type !== 'event')

  return (
    <AdminShell access={session.access}>
      <div className="admin-grid">
        <section className="admin-card">
          <h2>{showLegacy ? 'Event and place review' : 'Location review'}</h2>
          {content.map((item) => (
            <article key={`${item.subject_type}-${item.subject_id}`}>
              <p><strong>{item.title}</strong> · {item.subject_type} · {item.reason}</p>
              <OpenModerationCase compact subjectType={item.subject_type} subjectId={item.subject_id} title={`Review ${item.title}`} queue="content" category="safety" />
            </article>
          ))}
          {!content.length ? <p>No locations need review.</p> : null}
        </section>

        <section className="admin-card">
          <h2>Claims and verification</h2>
          {verification.map((item) => (
            <article key={`${item.subject_type}-${item.subject_id}`}>
              <p><strong>{item.title}</strong> · {item.state}</p>
              <OpenModerationCase compact subjectType={item.subject_type} subjectId={item.subject_id} title={`Verify ${item.title}`} queue="verification" category="verification" />
            </article>
          ))}
          {!verification.length ? <p>No location claims need review.</p> : null}
        </section>

        <section className="admin-card">
          <h2>Media scanning</h2>
          {(data?.media || []).map((item) => (
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
