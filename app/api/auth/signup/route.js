import { NextResponse } from 'next/server'
import { pathWithMessage } from '@/lib/auth/redirect'
import { registerAccount } from '@/lib/auth/sign-up'
import { enforceRequestSize } from '@/lib/security/request'
import { siteUrl } from '@/lib/auth/origin'

export const dynamic = 'force-dynamic'

function redirectWithError(request, message) {
  if (request.headers.get('accept')?.includes('application/json')) {
    return NextResponse.json({ error: message }, { status: 400, headers: { 'Cache-Control': 'no-store' } })
  }
  const target = siteUrl(request.headers, pathWithMessage('/landing.html', 'error', message, { mode: 'signup' }))
  const response = NextResponse.redirect(target, 303)
  response.headers.set('Cache-Control', 'no-store')
  return response
}

export async function POST(request) {
  try {
    enforceRequestSize(request, 16_000)
    const result = await registerAccount(await request.formData())
    if (result.error) return redirectWithError(request, result.error)

    if (request.headers.get('accept')?.includes('application/json')) {
      return NextResponse.json({ destination: result.destination }, { headers: { 'Cache-Control': 'no-store' } })
    }
    const response = NextResponse.redirect(siteUrl(request.headers, result.destination), 303)
    response.headers.set('Cache-Control', 'no-store')
    return response
  } catch {
    return redirectWithError(request, 'We could not create your account. Please try again.')
  }
}
