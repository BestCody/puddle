import { createClient } from '@/lib/supabase/server'
import { isSupabaseConfigured } from '@/lib/supabase/env'

export async function SystemNoticeBanner() {
  if (!isSupabaseConfigured()) return null
  try {
    const supabase = await createClient()
    const { data } = await supabase.rpc('active_system_notices_v1')
    if (!data?.length) return null
    return <div className="system-notices" role="status">{data.map((notice) => <div className={`system-notice is-${notice.severity}`} key={notice.id}><strong>{notice.title}</strong><span>{notice.body}</span></div>)}</div>
  } catch { return null }
}
