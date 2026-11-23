'use client'

import { DashboardRuntime } from './dashboard-runtime'
import { useProductIdentity } from './product-identity'

// The static shell renders before account data loads. The shared identity read
// (one request per shell) fills in the name and the profile ID that
// notification alerts subscribe with.
export function AccountMenuName() {
  const context = useProductIdentity()
  return <strong>{context?.identity?.displayName || 'Puddle person'}</strong>
}

export function StaticDashboardRuntime() {
  const context = useProductIdentity()
  return <DashboardRuntime profileId={context?.identity?.id || null} />
}
