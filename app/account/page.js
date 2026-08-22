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

  return <ProductShell user={user} profile={profile} settingsOverlay={!embedded && !mobileFlow}>
    <div className={`figma-settings-screen${embedded ? ' is-embedded' : ''}${mobileFlow ? ' is-mobile-flow' : ''}${mobileFlow && !selectedSection ? ' is-mobile-index' : ''}`}>
      <section className={windowClass} aria-label="Settings">
        {mobileFlow ? <Link className="figma-settings-mobile-back" href={mobileBackHref} aria-label={selectedSection ? 'Back to Settings' : 'Back to Profile'}>‹ <span>Back</span></Link> : <Link className="figma-settings-close" href={returnTo} aria-label="Close settings">×</Link>}
        <aside className="figma-settings-local-nav">
          <strong>Settings</strong>
          <nav>
            <Link href={settingsHref('profile', returnTo, { embedded, mobile: mobileFlow })}>Profile</Link>
            <Link href={settingsHref('security', returnTo, { embedded, mobile: mobileFlow })}>Email / Password</Link>
            <Link href={settingsHref('appearance', returnTo, { embedded, mobile: mobileFlow })}>Appearance</Link>
            <Link href={settingsHref('notifications', returnTo, { embedded, mobile: mobileFlow })}>Notifications{unread ? ` (${unread})` : ''}</Link>
            <Link href={settingsHref('sessions', returnTo, { embedded, mobile: mobileFlow })}>Sessions</Link>
            <Link href={settingsHref('billing', returnTo, { embedded, mobile: mobileFlow })}>Billing</Link>
            <Link href={settingsHref('account', returnTo, { embedded, mobile: mobileFlow })}>Account</Link>
          </nav>
        </aside>

        <div className="figma-settings-detail">
          <AuthMessage searchParams={params} />

          <form className="figma-settings-section" id="profile" action={updateDateProfile}>
            <header><small>Profile</small><h1>Profile</h1></header>
            <div className="figma-settings-row"><label>Display name</label><input name="display_name" defaultValue={profile?.display_name || ''} required maxLength="60" /></div>
            <div className="figma-settings-row"><label>Username</label><UsernameInput defaultValue={profile?.username || ''} id="account-username" /></div>
            <div className="figma-settings-row is-tall"><label>About</label><textarea name="bio" defaultValue={profile?.bio || ''} maxLength="500" /></div>
            <div className="figma-settings-row"><label>Visibility</label><select name="profile_visibility" defaultValue={profile?.profile_visibility || 'public'}><option value="public">Public</option><option value="friends">Friends</option><option value="mutuals">Mutuals</option><option value="attendees">Shared-plan attendees</option><option value="hidden">Hidden</option></select></div>
            <div className="figma-settings-submit"><SubmitButton pendingText="Saving…">Save</SubmitButton></div>
          </form>

          <section className="figma-settings-section" id="security">
            <header><small>Email / Password</small><h1>Email / Password</h1></header>
            <div className="figma-settings-row"><label>Email</label><span>{user.email || 'No email available'}</span><Link href="/change-email">Change</Link></div>
            <form action={updatePassword}>
              <div className="figma-settings-row"><label>New password</label><input name="password" type="password" minLength="10" maxLength="128" required /></div>
              <div className="figma-settings-row"><label>Confirm password</label><input name="password_confirmation" type="password" minLength="10" maxLength="128" required /></div>
              <div className="figma-settings-submit"><SubmitButton>Change password</SubmitButton></div>
            </form>
          </section>

          <form className="figma-settings-section" id="appearance" action={updateAppearance}>
            <header><small>Appearance</small><h1>Appearance</h1></header>
            <div className="figma-settings-row"><label>Theme</label><select name="appearance_theme" defaultValue={profile?.appearance_theme || 'light'}><option value="light">Light</option><option value="dark">Dark</option><option value="system">Use device setting</option></select></div>
            <div className="figma-settings-row"><label>Profile color</label><select name="profile_theme" defaultValue={profile?.profile_theme || 'blue'}><option value="blue">Blue</option><option value="green">Green</option><option value="yellow">Yellow</option><option value="purple">Purple</option><option value="red">Red</option><option value="grey">Grey</option></select></div>
            <div className="figma-settings-submit"><SubmitButton pendingText="Saving…">Save appearance</SubmitButton></div>
          </form>

          <section className="figma-settings-section" id="notifications">
            <header><small>Notifications</small><h1>Notifications</h1></header>
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
          </section>

          <section className="figma-settings-section" id="sessions">
            <header><small>Sessions</small><h1>Session</h1></header>
            <div className="figma-settings-row is-tall"><label>Current browser</label><span>{sessionExpiry}<br />Last sign-in: {user.last_sign_in_at ? new Date(user.last_sign_in_at).toLocaleString() : 'Unavailable'}</span></div>
            <form action={revokeOtherSessions}><div className="figma-settings-submit"><SubmitButton>Sign out other sessions</SubmitButton></div></form>
          </section>

          <section className="figma-settings-section" id="billing">
            <header><small>Billing</small><h1>Billing</h1></header>
            <div className="figma-settings-row"><label>Puddle Pass</label><Link href="/membership" target="_top">View Plans</Link></div>
          </section>

          <section className="figma-settings-section" id="account">
            <header><small>Account</small><h1>Account</h1></header>
            <p className="figma-settings-warning">Permanently delete your Puddle account and associated records.</p>
            <form action={deleteAccount}>
              <div className="figma-settings-row"><label>Type DELETE</label><input name="confirmation" autoComplete="off" required minLength="6" maxLength="6" pattern="DELETE" /></div>
              <div className="figma-settings-submit is-danger"><SubmitButton pendingText="Deleting…">Delete my account</SubmitButton></div>
            </form>
          </section>
        </div>
      </section>
    </div>
  </ProductShell>
}
