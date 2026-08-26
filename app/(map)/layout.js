import { StaticProductShell } from '@/components/static-product-shell'

// The map/feed document is a protected application shell. Authentication and
// account-state checks stay in proxy and the data APIs; this route does not
// block the first shell on a Supabase profile read.
export const dynamic = 'force-dynamic'

export default function MapLayout({ children }) {
  return <StaticProductShell>{children}</StaticProductShell>
}
