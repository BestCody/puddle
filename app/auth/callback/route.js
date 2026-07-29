import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isSupabaseConfigured } from '@/lib/supabase/env'
import { safeNextPath } from '@/lib/auth/redirect'

export async function GET(request) {
  const url = new URL(request.url)
  if (!isSupabaseConfigured()) return NextResponse.redirect(new URL('/signin?error=Accounts+are+temporarily+unavailable.+Please+try+again+later.', url))
  const code = url.searchParams.get('code')
  const next = safeNextPath(url.searchParams.get('next'), '/dashboard')
  if (!code) return NextResponse.redirect(new URL('/auth/error', url))
  const supabase = await createClient()
  const { error } = await supabase.auth.exchangeCodeForSession(code)
  if (error) return NextResponse.redirect(new URL('/auth/error', url))
  return NextResponse.redirect(new URL(next, url))
}
