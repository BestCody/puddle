import Link from 'next/link'
import { requirePrivileged } from '@/lib/auth/privileged'
import { getModerationCases } from '@/lib/app/admin-data'
import { AdminShell } from '@/components/admin-shell'
export const dynamic='force-dynamic';export const metadata={title:'Moderator cases',robots:{index:false,follow:false}}
export default async function CasesPage({searchParams}){const params=await searchParams;const session=await requirePrivileged(['content_moderator','trust_safety','super_admin','security','support']);const cases=await getModerationCases(session.supabase,{state:params?.state,queue:params?.queue});return <AdminShell access={session.access}><div className="admin-table">{cases.map((item)=><Link className={`admin-case is-${item.priority}`} href={`/admin/cases/${item.id}`} key={item.id}><span>{item.case_number}</span><strong>{item.title}</strong><small>{item.subject_type} · {item.state} · {item.priority}</small><em>{item.sla_due_at?new Date(item.sla_due_at).toLocaleString('en-US'):'No SLA'}</em></Link>)}{!cases.length?<p>No cases match this queue.</p>:null}</div></AdminShell>}
