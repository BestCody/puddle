import { AuthMessage } from '@/components/auth-message'
import { EmptyState } from '@/components/empty-state'
import { renderProductPage } from '@/lib/app/render-product-page'
import { getNotificationsSnapshot } from '@/lib/app/social-data'
import { markAllNotificationsRead, markNotificationRead, saveNotificationPreferences } from '@/app/social/actions'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Notifications' }

const toggles = [
  ['in_app_enabled','In-app notifications'],['email_enabled','Email notifications'],['friend_requests','Friend requests'],['shares','Shared events and places'],['messages','Messages'],['comments','Comments and replies'],['event_reminders','Event reminders'],['event_changes','Event changes and cancellations'],['host_announcements','Host announcements'],['marketing','Optional product updates']
]

export default async function NotificationsPage({ searchParams }) {
  const params = await searchParams
  return renderProductPage(async (session) => {
    const data = await getNotificationsSnapshot(session)
    return <><section className="page-heading-row"><div><span className="section-pill section-pill-yellow">Stay in the loop</span><h1 className="product-title">Notifications.</h1><p>Useful plan updates without turning Puddle into noise.</p></div>{data.unreadCount ? <form action={markAllNotificationsRead}><button className="splash-button splash-button-yellow" type="submit">Mark all read</button></form> : null}</section><AuthMessage searchParams={params}/>
      <div className="notifications-layout"><main>{data.notifications.length ? <div className="notification-list">{data.notifications.map((notification)=><form className={`notification-card ${notification.read_at?'':'is-unread'}`} action={markNotificationRead} key={notification.id}><input type="hidden" name="notification_id" value={notification.id}/><input type="hidden" name="href" value={notification.href || '/notifications'}/><button type="submit"><span className="notification-symbol">{notification.kind==='message'?'✉':notification.kind.includes('friend')?'☺':notification.kind.includes('event')?'✦':'◎'}</span><div><small>{notification.kind.replaceAll('_',' ')}</small><strong>{notification.title}</strong><p>{notification.body}</p><time>{new Date(notification.created_at).toLocaleString('en-CA',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})}</time></div>{!notification.read_at?<i>new</i>:null}</button></form>)}</div> : <EmptyState icon="♢" title="All caught up." description="Friend requests, shared plans, messages, reminders, and event changes appear here." actionHref="/discover" actionLabel="Discover something"/>}</main>
        <aside className="notification-settings"><span className="section-pill section-pill-mint">Preferences</span><h2>Choose what reaches you.</h2><form action={saveNotificationPreferences}>{toggles.map(([name,label])=><label className="settings-toggle" key={name}><input type="checkbox" name={name} defaultChecked={Boolean(data.preferences?.[name])}/><span>{label}</span></label>)}<label>Quiet hours start<input type="time" name="quiet_start" defaultValue={data.preferences?.quiet_start || ''}/></label><label>Quiet hours end<input type="time" name="quiet_end" defaultValue={data.preferences?.quiet_end || ''}/></label><label>Timezone<input name="timezone" defaultValue={data.preferences?.timezone || 'America/Toronto'}/></label><p className="settings-note">Transactional safety, ticket, and account messages may still be sent when required.</p><button type="submit">Save preferences</button></form></aside>
      </div>
    </>
  })
}
