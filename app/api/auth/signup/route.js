import { NextResponse } from 'next/server'
import { pathWithMessage } from '@/lib/auth/redirect'
import { registerAccount } from '@/lib/auth/sign-up'
import { enforceRequestSize } from '@/lib/security/request'

export const dynamic = 'force-dynamic'

function redirectWithError(request, message) {
  const target = new URL(pathWithMessage('/', 'error', message, { mode: 'signup' }), request.url)
  const response = NextResponse.redirect(target, 303)
  response.headers.set('Cache-Control', 'no-store')
  return response
}

export async function POST(request) {
  try {
    enforceRequestSize(request, 16_000)
    const result = await registerAccount(await request.formData())
    if (result.error) return redirectWithError(request, result.error)

    const response = NextResponse.redirect(new URL(result.destination, request.url), 303)
    response.headers.set('Cache-Control', 'no-store')
    return response
  } catch {
    return redirectWithError(request, 'We could not create your account. Please try again.')
  }
}
