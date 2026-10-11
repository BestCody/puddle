import { ProductShell } from '@/components/product-shell'
import { requireUser } from './data'

export async function renderProductPage(render) {
  const session = await requireUser()
  return <ProductShell user={session.user} profile={session.profile}>{await render(session)}</ProductShell>
}
