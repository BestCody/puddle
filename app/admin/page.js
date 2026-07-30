import Link from 'next/link'
import { requirePrivileged } from '@/lib/auth/privileged'
import { getAdminDashboard } from '@/lib/app/admin-data'
import { AdminShell } from '@/components/admin-shell'
import { SystemNoticeConsole } from '@/components/system-notice-console'

export const dynamic='force-dynamic';export const metadata={title:'Administration',robots:{index:false,follow:false}}
export default async function AdminPage(){const session=await requirePrivileged();const data=await getAdminDashboard(session.supabase);return <AdminShell access={session.access}><section className="admin-metric-grid">{Object.entries(data.counts||{}).map(([key,value])=><article className="admin-metric" key={key}><strong>{value}</strong><span>{key.replaceAll('_',' ')}</span></article>)}</section><section className="admin-grid"><article className="admin-card"><h2>Urgent cases</h2>{(data.urgent||[]).map((item)=><Link href={`/admin/cases/${item.id}`} key={item.id}>{item.case_number} · {item.title}</Link>)}{!data.urgent?.length?<p>No urgent cases.</p>:null}</article><article className="admin-card"><h2>Security alerts</h2>{(data.alerts||[]).map((item)=><p key={item.id}><strong>{item.severity}</strong> {item.title}</p>)}{!data.alerts?.length?<p>No open alerts.</p>:null}</article></section>{session.access?.roles?.some((role)=>['super_admin','support','incident_commander'].includes(role))?<SystemNoticeConsole />:null}</AdminShell>}
