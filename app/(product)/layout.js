import { StaticProductShell } from '@/components/static-product-shell'

// The proxy has already authenticated protected product requests. Keep the
// navigation chrome independent from the profile read so the route can stream
// its authenticated content as soon as the page data is ready.
export const dynamic = 'force-dynamic'

export default function ProductLayout({ children }) {
  return <StaticProductShell>{children}</StaticProductShell>
}
