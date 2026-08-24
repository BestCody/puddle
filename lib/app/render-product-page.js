import { headers } from 'next/headers'
import { ProductShell } from '@/components/product-shell'
import { requireUser } from '@/lib/auth/user'

async function usesPersistentProductShell() {
  try {
    const requestHeaders = await headers()
    return requestHeaders.get('x-puddle-product-route') === '1'
  } catch {
    return false
  }
}

export async function renderProductPage(render) {
  const session = await requireUser({ onboarding: true })
  const contentPromise = render(session)
  if (await usesPersistentProductShell()) return contentPromise
  return (
    <ProductShell user={session.user} profile={session.profile} contentPromise={contentPromise} />
  )
}
