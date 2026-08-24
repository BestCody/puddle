import Link from 'next/link'
import { ProductShell } from '@/components/product-shell'
import { AuthMessage } from '@/components/auth-message'
import { SubmitButton } from '@/components/submit-button'
import { UsernameInput } from '@/components/username-input'
import { PassNotificationAlertControl } from '@/components/pass-notification-alerts'
import { deleteAccount, revokeOtherSessions, updatePassword } from '@/app/auth/actions'
import { markAllNotificationsRead, markNotificationRead, updateAppearance, updateDateProfile, updateNotificationPreferences } from './actions'
import { requireUser } from '@/lib/auth/user'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Settings' }

const settingsSections = new Set(['profile', 'security', 'appearance', 'notifications', 'sessions', 'billing', 'account'])
const dashboardReturnPaths = new Set(['/discover', '/map', '/plans', '/matches', '/membership', '/profile'])

function SettingsSectionIcon({ section }) {
  if (section === 'profile') return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="3.25"/><path d="M5.75 19c.55-3.65 2.65-5.5 6.25-5.5s5.7 1.85 6.25 5.5"/></svg>
  if (section === 'security') return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5.5" y="10" width="13" height="9.5" rx="2.5"/><path d="M8.5 10V7.5a3.5 3.5 0 0 1 7 0V10"/></svg>
  if (section === 'appearance') return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2.75v2.1M12 19.15v2.1M2.75 12h2.1M19.15 12h2.1M5.46 5.46l1.48 1.48M17.06 17.06l1.48 1.48M18.54 5.46l-1.48 1.48M6.94 17.06l-1.48 1.48"/></svg>
  if (section === 'notifications') return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.75 10.2c0-3.35 2.05-5.45 5.25-5.45s5.25 2.1 5.25 5.45v3.25l1.35 2.3H5.4l1.35-2.3V10.2Z"/><path d="M9.6 18.05c.5.8 1.3 1.2 2.4 1.2s1.9-.4 2.4-1.2"/></svg>
  if (section === 'sessions') return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.75" y="4.75" width="16.5" height="11.5" rx="2.25"/><path d="M8.5 19.25h7M12 16.25v3"/></svg>
  if (section === 'billing') return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.75" y="6" width="16.5" height="12" rx="2.25"/><path d="M3.75 10h16.5M7 14.1h3"/></svg>
  return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M12 3.25v2M12 18.75v2M3.25 12h2M18.75 12h2M5.82 5.82l1.42 1.42M16.76 16.76l1.42 1.42M18.18 5.82l-1.42 1.42M7.24 16.76l-1.42 1.42"/></svg>
}

function SettingsNavLink({ section, label, href, suffix = '' }) {
  return <Link href={href} data-settings-section={section}>
    <span className="figma-settings-nav-icon"><SettingsSectionIcon section={section} /></span>
    <span className="figma-settings-nav-label">{label}{suffix}</span>
  </Link>
}

function safeReturnTo(value) {
  if (typeof value !== 'string') return '/profile'
  const path = value.split('?')[0]
  return dashboardReturnPaths.has(path) ? value : '/profile'
}

function settingsHref(section, returnTo, { embedded = false, mobile = false } = {}) {
  const params = new URLSearchParams()
  if (embedded) params.set('embedded', '1')
  if (mobile) params.set('mobile', '1')
  params.set('section', section)
  params.set('returnTo', returnTo)
  return `/account?${params.toString()}`
}

function mobileSettingsIndexHref(returnTo) {
  return `/account?mobile=1&returnTo=${encodeURIComponent(returnTo)}`
}

function notificationHref(value) {
  const href = String(value || '')
  return href.startsWith('/') && !href.startsWith('//') ? href : null
}

function notificationTime(value) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('en-CA', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

export default async function AccountPage({ searchParams }) {
  const params = await searchParams
  const embedded = params?.embedded === '1'
  const mobileFlow = params?.mobile === '1'
  const selectedSection = settingsSections.has(params?.section) ? params.section : embedded ? 'profile' : null
  const returnTo = safeReturnTo(params?.returnTo)
  const { user, profile, supabase } = await requireUser({ onboarding: true })
  const sessionExpiry = user.aud ? 'Managed securely by Supabase Auth' : 'Active'
  const [{ data: notificationRows }, { data: preferenceRow }, { data: passActive }] = await Promise.all([
    supabase.from('notifications').select('id,kind,title,body,href,read_at,created_at').eq('profile_id', user.id).order('created_at', { ascending: false }).limit(50),
    supabase.from('notification_preferences').select('in_app_enabled,friend_requests,shares,messages,comments,event_reminders,event_changes,host_announcements,marketing,timezone').eq('profile_id', user.id).maybeSingle(),
    supabase.rpc('puddle_tinder_active_v1')
  ])
  const notifications = notificationRows || []
  const preferences = preferenceRow || {
    in_app_enabled: true,
    friend_requests: true,
    shares: true,
    messages: true,
    comments: true,
    event_reminders: true,
    event_changes: true,
    host_announcements: true,
    marketing: false,
    timezone: profile?.timezone || 'America/Toronto'
  }
  const unread = notifications.filter((item) => !item.read_at).length
  const windowClass = `figma-settings-window${selectedSection ? ` is-expanded section-${selectedSection}` : ' section-index'}${mobileFlow ? ' is-mobile-flow-window' : ''}`
  const mobileBackHref = selectedSection ? mobileSettingsIndexHref(returnTo) : returnTo

  return <ProductShell user={user} profile={profile} settingsOverlay={!embedded}>
    <div className={`figma-settings-screen${embedded ? ' is-embedded' : ''}${mobileFlow ? ' is-mobile-flow' : ''}${mobileFlow && !selectedSection ? ' is-mobile-index' : ''}`}>
      <section className={windowClass} aria-label="Settings">
        {mobileFlow ? <Link className="figma-settings-mobile-back" href={mobileBackHref} aria-label={selectedSection ? 'Back to Settings' : 'Back to Profile'}>‹ <span>Back</span></Link> : <Link className="figma-settings-close" href={returnTo} aria-label="Close settings">×</Link>}
        <aside className="figma-settings-local-nav">
          <strong>Settings</strong>
          <nav>
            <SettingsNavLink section="profile" label="Profile" href={settingsHref('profile', returnTo, { embedded, mobile: mobileFlow })} />
            <SettingsNavLink section="security" label="Email / Password" href={settingsHref('security', returnTo, { embedded, mobile: mobileFlow })} />
            <SettingsNavLink section="appearance" label="Appearance" href={settingsHref('appearance', returnTo, { embedded, mobile: mobileFlow })} />
            <SettingsNavLink section="notifications" label="Notifications" suffix={unread ? ` (${unread})` : ''} href={settingsHref('notifications', returnTo, { embedded, mobile: mobileFlow })} />
            <SettingsNavLink section="sessions" label="Sessions" href={settingsHref('sessions', returnTo, { embedded, mobile: mobileFlow })} />
            <SettingsNavLink section="billing" label="Billing" href={settingsHref('billing', returnTo, { embedded, mobile: mobileFlow })} />
            <SettingsNavLink section="account" label="Account" href={settingsHref('account', returnTo, { embedded, mobile: mobileFlow })} />
          </nav>
        </aside>

        <div className="figma-settings-detail">
          <AuthMessage searchParams={params} />

          <form className="figma-settings-section" id="profile" action={updateDateProfile}>
            <header><small>Profile</small><h1>Profile</h1><p>Manage how your profile appears across Puddle.</p></header>
            <div className="figma-settings-section-body">
              <div className="figma-settings-row"><label>Display name</label><input name="display_name" defaultValue={profile?.display_name || ''} required maxLength="60" /></div>
              <div className="figma-settings-row"><label>Username</label><UsernameInput defaultValue={profile?.username || ''} id="account-username" /></div>
              <div className="figma-settings-row is-tall"><label>About</label><textarea name="bio" defaultValue={profile?.bio || ''} maxLength="500" /></div>
              <div className="figma-settings-row"><label>Visibility</label><select name="profile_visibility" defaultValue={profile?.profile_visibility || 'public'}><option value="public">Public</option><option value="friends">Friends</option><option value="mutuals">Mutuals</option><option value="attendees">Shared-plan attendees</option><option value="hidden">Hidden</option></select></div>
            </div>
            <div className="figma-settings-submit"><SubmitButton pendingText="Saving…">Save changes</SubmitButton></div>
          </form>

          <section className="figma-settings-section" id="security">
            <header><small>Email / Password</small><h1>Email / Password</h1><p>Update your sign-in details and password.</p></header>
            <div className="figma-settings-section-body">
              <div className="figma-settings-row"><label>Email</label><span>{user.email || 'No email available'}</span><Link href="/change-email">Change</Link></div>
              <form action={updatePassword} className="figma-settings-nested-form">
                <div className="figma-settings-row"><label>New password</label><input name="password" type="password" minLength="10" maxLength="128" required /></div>
                <div className="figma-settings-row"><label>Confirm password</label><input name="password_confirmation" type="password" minLength="10" maxLength="128" required /></div>
                <div className="figma-settings-submit"><SubmitButton>Change password</SubmitButton></div>
              </form>
            </div>
          </section>

          <form className="figma-settings-section" id="appearance" action={updateAppearance}>
            <header><small>Appearance</small><h1>Appearance</h1><p>Choose how Puddle looks for you.</p></header>
            <div className="figma-settings-section-body">
              <div className="figma-settings-row"><label>Theme</label><select name="appearance_theme" defaultValue={profile?.appearance_theme || 'light'}><option value="light">Light</option><option value="dark">Dark</option><option value="system">Use device setting</option></select></div>
              <div className="figma-settings-row"><label>Profile color</label><select name="profile_theme" defaultValue={profile?.profile_theme || 'blue'}><option value="blue">Blue</option><option value="green">Green</option><option value="yellow">Yellow</option><option value="purple">Purple</option><option value="red">Red</option><option value="grey">Grey</option></select></div>
            </div>
            <div className="figma-settings-submit"><SubmitButton pendingText="Saving…">Save appearance</SubmitButton></div>
          </form>

          <section className="figma-settings-section" id="notifications">
            <header><small>Notifications</small><h1>Notifications</h1><p>Control what Puddle lets you know about.</p></header>
            <div className="figma-settings-section-body figma-settings-section-body--notifications">
              <PassNotificationAlertControl enabled={Boolean(passActive)} />
              <form action={updateNotificationPreferences} className="figma-notification-preferences">
                <input type="hidden" name="timezone" value={preferences.timezone || profile?.timezone || 'America/Toronto'} />
                <label><input type="checkbox" name="in_app_enabled" defaultChecked={preferences.in_app_enabled} /> In-app notifications</label>
                <label><input type="checkbox" name="friend_requests" defaultChecked={preferences.friend_requests} /> Friend requests</label>
                <label><input type="checkbox" name="shares" defaultChecked={preferences.shares} /> Shares</label>
                <label><input type="checkbox" name="messages" defaultChecked={preferences.messages} /> Messages</label>
                <label><input type="checkbox" name="comments" defaultChecked={preferences.comments} /> Comments</label>
                <label><input type="checkbox" name="event_reminders" defaultChecked={preferences.event_reminders} /> Event reminders</label>
                <label><input type="checkbox" name="event_changes" defaultChecked={preferences.event_changes} /> Event changes</label>
                <label><input type="checkbox" name="host_announcements" defaultChecked={preferences.host_announcements} /> Host announcements</label>
                <label><input type="checkbox" name="marketing" defaultChecked={preferences.marketing} /> Product updates</label>
                <div className="figma-settings-submit"><SubmitButton pendingText="Saving…">Save notifications</SubmitButton></div>
              </form>
              <div className="figma-notification-list-heading"><strong>Recent</strong>{unread ? <form action={markAllNotificationsRead}><button type="submit">Mark all read</button></form> : null}</div>
              <div className="figma-notification-list">{notifications.length ? notifications.map((item) => {
                const href = notificationHref(item.href)
                return <article className={item.read_at ? '' : 'is-unread'} key={item.id}>
                  <div><small>{notificationTime(item.created_at)} · {item.kind.replaceAll('_', ' ')}</small><strong>{item.title}</strong><p>{item.body}</p></div>
                  <div>{href ? <Link href={href}>Open</Link> : null}{!item.read_at ? <form action={markNotificationRead}><input type="hidden" name="notification_id" value={item.id} /><button type="submit">Mark read</button></form> : null}</div>
                </article>
              }) : <p>No notifications yet.</p>}</div>
            </div>
          </section>

          <section className="figma-settings-section" id="sessions">
            <header><small>Sessions</small><h1>Sessions</h1><p>Review and manage where your account is signed in.</p></header>
            <div className="figma-settings-section-body">
              <div className="figma-settings-row is-tall"><label>Current browser</label><span>{sessionExpiry}<br />Last sign-in: {user.last_sign_in_at ? new Date(user.last_sign_in_at).toLocaleString() : 'Unavailable'}</span></div>
            </div>
            <form action={revokeOtherSessions}><div className="figma-settings-submit"><SubmitButton>Sign out other sessions</SubmitButton></div></form>
          </section>

          <section className="figma-settings-section" id="billing">
            <header><small>Billing</small><h1>Billing</h1><p>Manage your Puddle Pass and plan.</p></header>
            <div className="figma-settings-section-body">
              <div className="figma-settings-row"><label>Puddle Pass</label><span>Membership and plan details</span><Link href="/membership" target="_top">View plans</Link></div>
            </div>
          </section>

          <section className="figma-settings-section" id="account">
            <header><small>Account</small><h1>Account</h1><p>Account-level controls and permanent actions.</p></header>
            <div className="figma-settings-section-body figma-settings-section-body--danger">
              <p className="figma-settings-warning">Permanently delete your Puddle account and associated records.</p>
              <form action={deleteAccount}>
                <div className="figma-settings-row"><label>Type DELETE</label><input name="confirmation" autoComplete="off" required minLength="6" maxLength="6" pattern="DELETE" /></div>
                <div className="figma-settings-submit is-danger"><SubmitButton pendingText="Deleting…">Delete my account</SubmitButton></div>
              </form>
            </div>
          </section>
        </div>
      </section>
    </div>
  </ProductShell>
}
