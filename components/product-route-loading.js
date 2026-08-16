const labels = {
  discover: 'Swipe',
  map: 'Feed',
  plans: 'Saved',
  matches: 'Friends',
  membership: 'Pass',
  profile: 'Profile'
}

function NavigationSkeleton() {
  return <>
    <aside className="product-route-loading-sidebar" aria-hidden="true">
      <span className="product-route-loading-logo" />
      <div>{Array.from({ length: 6 }, (_, index) => <span key={index} />)}</div>
    </aside>
    <div className="product-route-loading-mobile-nav" aria-hidden="true">
      {Array.from({ length: 6 }, (_, index) => <span key={index} />)}
    </div>
  </>
}

function DiscoverSkeleton() {
  return <div className="product-route-loading-discover" aria-hidden="true">
    <span className="product-route-loading-filter" />
    <div className="product-route-loading-swipe-card"><span /><span /><span /></div>
    <div className="product-route-loading-actions">{Array.from({ length: 4 }, (_, index) => <span key={index} />)}</div>
  </div>
}

function MapSkeleton() {
  return <div className="product-route-loading-map" aria-hidden="true">
    <div className="product-route-loading-toolbar"><span /><span /><span /></div>
    <div className="product-route-loading-map-canvas" />
    <div className="product-route-loading-map-list">{Array.from({ length: 3 }, (_, index) => <span key={index} />)}</div>
  </div>
}

function ListSkeleton({ rows = 4 }) {
  return <div className="product-route-loading-list" aria-hidden="true">
    <span className="product-route-loading-heading" />
    {Array.from({ length: rows }, (_, index) => <div key={index}><span /><i /><i /></div>)}
  </div>
}

function MembershipSkeleton() {
  return <div className="product-route-loading-membership" aria-hidden="true">
    <span className="product-route-loading-heading" />
    <div className="product-route-loading-pass-card"><span /><span /><span /><span /></div>
  </div>
}

function ProfileSkeleton() {
  return <div className="product-route-loading-profile" aria-hidden="true">
    <span className="product-route-loading-avatar" />
    <span className="product-route-loading-profile-name" />
    <span className="product-route-loading-profile-copy" />
    <div>{Array.from({ length: 3 }, (_, index) => <span key={index} />)}</div>
  </div>
}

function RouteBody({ variant }) {
  if (variant === 'discover') return <DiscoverSkeleton />
  if (variant === 'map') return <MapSkeleton />
  if (variant === 'membership') return <MembershipSkeleton />
  if (variant === 'profile') return <ProfileSkeleton />
  if (variant === 'matches') return <ListSkeleton rows={5} />
  return <ListSkeleton rows={4} />
}

export function ProductRouteLoading({ variant = 'plans' }) {
  const label = labels[variant] || 'Puddle'
  return <div className="product-route-loading-shell" role="status" aria-live="polite" aria-busy="true" aria-label={`Loading ${label}`}>
    <NavigationSkeleton />
    <main className={`product-route-loading-stage is-${variant}`}>
      <RouteBody variant={variant} />
    </main>
  </div>
}
