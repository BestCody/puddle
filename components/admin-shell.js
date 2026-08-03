import Link from 'next/link'

const links = [
  ['/admin', 'Overview'],
  ['/admin/cases', 'Cases'],
  ['/admin/users', 'Users'],
  ['/admin/content', 'Locations'],
  ['/admin/security', 'Security']
]

export function AdminShell({ access, children }) {
  return <div className="admin-shell">
    <header className="admin-header">
      <div>
        <span className="section-pill section-pill-yellow">Privileged workspace</span>
        <h1>Puddle administration</h1>
        <p>MFA-protected location moderation, venue verification, user safety, and security response.</p>
      </div>
      <Link href="/discover">Exit admin</Link>
    </header>
    <nav className="admin-nav">
      {links.map(([href, label]) => <Link href={href} key={href}>{label}</Link>)}
      <span>{(access?.roles || []).join(' · ')}</span>
    </nav>
    {children}
  </div>
}
