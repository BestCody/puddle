import { requirePrivileged } from '@/lib/auth/privileged'
import { requiredQuery } from '@/lib/app/required-query'
import { AdminShell } from '@/components/admin-shell'
import { PrivilegedRoleConsole } from '@/components/privileged-role-console'
import { FeatureFlagConsole } from '@/components/feature-flag-console'
import { SecurityAlertConsole } from '@/components/security-alert-console'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Security operations', robots: { index: false, follow: false } }

export default async function SecurityPage() {
  const session = await requirePrivileged(['security', 'super_admin', 'incident_commander'])
  let data
  let flags
  try {
    [data, flags] = await Promise.all([
      requiredQuery(session.supabase.rpc('admin_security_dashboard_v1')),
      requiredQuery(session.supabase.from('feature_flags').select('key,enabled,config,risk_tier,requires_incident_approval').order('key'))
    ])
    if (!data || !data.counts || !Array.isArray(data.alerts) || !Array.isArray(data.rate_limits) || !Array.isArray(data.linked_accounts) || !Array.isArray(flags)) {
      throw new Error('Security dashboard returned incomplete data.')
    }
  } catch (error) {
    console.error('Security dashboard failed:', error)
    return <AdminShell access={session.access}><section className="admin-card" role="alert"><h2>Security operations unavailable</h2><p>Security data could not be loaded. No alerts have been cleared.</p><a href="/admin/security">Try again</a></section></AdminShell>
  }

  return <AdminShell access={session.access}>
    <section className="admin-metric-grid">{Object.entries(data.counts).map(([key, value]) => <article className="admin-metric" key={key}><strong>{value}</strong><span>{key.replaceAll('_', ' ')}</span></article>)}</section>
    <div className="admin-grid">
      <SecurityAlertConsole alerts={data.alerts} />
      <section className="admin-card"><h2>Rate-limit pressure</h2>{data.rate_limits.map((item, index) => <p key={index}>{item.action_name} · {item.dimension_type} · {item.count}</p>)}</section>
      <section className="admin-card"><h2>Linked-account signals</h2>{data.linked_accounts.map((item) => <p key={item.id}>{item.signal_type} · confidence {item.confidence}</p>)}</section>
    </div>
    <FeatureFlagConsole flags={flags} />
    <PrivilegedRoleConsole />
  </AdminShell>
}
