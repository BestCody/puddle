import { ProductShell } from '@/components/product-shell'
import { requireUser } from '@/lib/auth/user'

export const dynamic = 'force-dynamic'

export default async function ProductLayout({ children }) {
  const session = await requireUser({ onboarding: true })
  return <ProductShell user={session.user} profile={session.profile}>{children}</ProductShell>
}
