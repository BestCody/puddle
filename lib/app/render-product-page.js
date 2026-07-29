import { ProductShell } from '@/components/product-shell'
import { requireUser } from '@/lib/auth/user'

export async function renderProductPage(render) {
  const session = await requireUser({ onboarding: true })
  return (
    <ProductShell user={session.user} profile={session.profile}>
      {await render(session)}
    </ProductShell>
  )
}
