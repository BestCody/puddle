import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isSupabaseConfigured } from '@/lib/supabase/env'
import { safeNextPath } from '@/lib/auth/redirect'

const allowedTypes = new Set(['signup', 'invite', 'magiclink', 'recovery', 'email_change', 'email'])

export async function GET(request) {
  const url = new URL(request.url)
  if (!isSupabaseConfigured()) return NextResponse.redirect(new URL('/signin?error=Accounts+are+temporarily+unavailable.+Please+try+again+later.', url))
  const tokenHash = url.searchParams.get('token_hash')
  const type = url.searchParams.get('type')
  const next = safeNextPath(url.searchParams.get('next'), '/dashboard')
  if (!tokenHash || !allowedTypes.has(type)) return NextResponse.redirect(new URL('/auth/error', url))
  const supabase = await createClient()
  const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type })
  if (error) return NextResponse.redirect(new URL('/auth/error', url))
  return NextResponse.redirect(new URL(next, url))
}
