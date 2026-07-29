import Link from 'next/link'
import { PuddleLogo } from '@/components/puddle-logo'
import { AuthMessage } from '@/components/auth-message'
import { signOut } from '@/app/auth/actions'
import { requireUser } from '@/lib/auth/user'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Dashboard' }

const events = [
  ['/events/neon-night.svg','Neon Garden','Fri · 10:00 PM'],
  ['/events/rooftop.svg','Rooftop Cinema','Sun · 8:45 PM'],
  ['/events/ceramics.svg','Clay & Cabernet','Sat · 6:30 PM']
]

export default async function DashboardPage({ searchParams }) {
  const { user, profile } = await requireUser({ onboarding: true })
  return (
    <div className="app-shell">
      <header className="app-header"><PuddleLogo /><nav className="app-nav"><Link href="/dashboard">Discover</Link><Link href="/account">Account</Link><form action={signOut}><button type="submit">Sign out</button></form></nav></header>
      <main className="app-main">
        <AuthMessage searchParams={searchParams} />
        <section className="welcome-card"><span className="eyebrow">Good evening</span><h1>Hey {profile.display_name}.</h1><p>Your real account session is active. Event discovery can now be connected to this authenticated profile in the next implementation phase.</p></section>
        <section className="dashboard-grid"><article className="dash-card"><span className="muted">Saved plans</span><div className="dash-number">0</div><p>Swipe right and they will land here.</p></article><article className="dash-card"><span className="muted">Profile</span><h2>@{profile.username}</h2><p>{profile.city || 'Add your city'} · {profile.search_radius_km} km radius</p></article><article className="dash-card"><span className="muted">Session</span><h2>{user.email_confirmed_at ? 'Email verified' : 'Email not verified'}</h2><p>{user.email}</p></article></section>
        <div className="section-heading"><div><span className="eyebrow">Preview deck</span><h2>Things your feed could love.</h2></div><span className="muted">Hardcoded until the event phase</span></div>
        <section className="event-strip">{events.map(([image,title,date])=><article className="mini-event" key={title}><img src={image} alt="" /><div><span className="eyebrow">For you</span><h3>{title}</h3><p>{date}</p></div></article>)}</section>
      </main>
    </div>
  )
}
