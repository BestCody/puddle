import Link from 'next/link'
import { legacySystemsEnabled } from '@/lib/product-vision'

const coreLinks=[['/admin','Overview'],['/admin/cases','Cases'],['/admin/users','Users'],['/admin/content','Locations'],['/admin/security','Security']]
const legacyLinks=[['/admin','Overview'],['/admin/cases','Cases'],['/admin/users','Users'],['/admin/content','Content'],['/admin/finance','Payments'],['/admin/security','Security']]

export function AdminShell({ access, children }) {
  const showLegacy=legacySystemsEnabled()
  const links=showLegacy?legacyLinks:coreLinks
  return <div className="admin-shell"><header className="admin-header"><div><span className="section-pill section-pill-yellow">Privileged workspace</span><h1>Puddle administration</h1><p>{showLegacy?'MFA-protected moderation, verification, payment operations, and security response.':'MFA-protected location moderation, venue verification, user safety, and security response.'}</p></div><Link href="/discover">Exit admin</Link></header><nav className="admin-nav">{links.map(([href,label])=><Link href={href} key={href}>{label}</Link>)}<span>{(access?.roles||[]).join(' · ')}</span></nav>{children}</div>
}
