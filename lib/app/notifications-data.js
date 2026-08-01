export async function getNotificationSnapshot(session, limit = 50) {
  const safeLimit = Math.min(100, Math.max(1, Number(limit) || 50))
  const { data, error } = await session.supabase
    .from('app_notifications')
    .select('id,kind,title,body,href,metadata,read_at,created_at')
    .eq('profile_id', session.user.id)
    .order('created_at', { ascending: false })
    .limit(safeLimit)
  const items = error ? [] : data || []
  return {
    items,
    unreadCount: items.filter((item) => !item.read_at).length,
    latestCreatedAt: items[0]?.created_at || null
  }
}
