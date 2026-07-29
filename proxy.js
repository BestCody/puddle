import { NextResponse } from 'next/server'
import { updateSession } from '@/lib/supabase/proxy'

const protectedPrefixes = ['/dashboard', '/onboarding', '/account']
const authOnlyPaths = ['/signin', '/signup', '/forgot-password']

function carriesCookies(source, target) {
  for (const cookie of source.cookies.getAll()) {
    target.cookies.set(cookie.name, cookie.value, cookie)
  }
  return target
}

export async function proxy(request) {
  const { response, user, configured } = await updateSession(request)
  const pathname = request.nextUrl.pathname
  const isProtected = protectedPrefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))
  const isAuthOnly = authOnlyPaths.includes(pathname)

  if (isProtected && !configured) {
    const url = new URL('/signin', request.url)
    url.searchParams.set('error', 'Accounts are temporarily unavailable. Please try again later.')
    return carriesCookies(response, NextResponse.redirect(url))
  }

  if (isProtected && !user) {
    const url = new URL('/signin', request.url)
    url.searchParams.set('next', `${pathname}${request.nextUrl.search}`)
    return carriesCookies(response, NextResponse.redirect(url))
  }

  if (isAuthOnly && user) {
    return carriesCookies(response, NextResponse.redirect(new URL('/dashboard', request.url)))
  }

  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|css|js)$).*)']
}
