import Link from 'next/link'
import { PuddleLogo } from './puddle-logo'
import { ResizableProductSidebar } from './resizable-product-sidebar'
import { ProductNav } from './product-nav'
import { signOut } from '@/app/auth/actions'
import { createClient } from '@/lib/supabase/server'

export async function ProductShell({ user, profile, children }) {
  let supabase = null
  async function database() {
    if (!supabase) supabase = await createClient()
    return supabase
  }

  let avatarUrl = null
  if (profile?.avatar_path) {
    if (String(profile.avatar_path).startsWith('/') || String(profile.avatar_path).startsWith('http')) avatarUrl = profile.avatar_path
    else {
      const client = await database()
      avatarUrl = client.storage.from('puddle-public-media').getPublicUrl(profile.avatar_path).data.publicUrl
    }
  }

  let showAdmin = ['admin', 'moderator', 'support', 'finance'].includes(profile?.role)
  if (!showAdmin) {
    try {
      const client = await database()
      const { data } = await client.rpc('privileged_access_v1', { required_roles: [] })
      showAdmin = Boolean(data?.allowed)
    } catch {}
  }

  return (
    <div className="product-shell minimal-product-shell">
      <ResizableProductSidebar className="minimal-product-sidebar" avatarUrl={avatarUrl} />

      <div className="product-stage minimal-product-stage">
        <header className="product-header minimal-product-header">
          <div className="minimal-header-logo"><PuddleLogo compact href="/discover" /></div>
          <details className="profile-menu">
            <summary aria-label="Open profile menu">
              <span className="figma-menu-icon" aria-hidden="true"><i /><i /><i /></span>
            </summary>
            <div className="profile-menu-panel">
              <div className="profile-menu-person"><strong>{profile?.display_name || 'Puddle person'}</strong></div>
              <Link href="/profile">Profile</Link>
              <Link href="/membership">Pass</Link>
              <Link href="/account">Settings</Link>
              {showAdmin ? <Link href="/admin">Admin</Link> : null}
              <form action={signOut}><button type="submit">Sign out</button></form>
            </div>
          </details>
        </header>
        <main className="product-main minimal-product-main">{children}</main>
      </div>

      <ProductNav mobile avatarUrl={avatarUrl} />
    </div>
  )
}
