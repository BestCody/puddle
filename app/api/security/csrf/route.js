import { randomBytes } from 'node:crypto'
import { NextResponse } from 'next/server'
import { csrfCookieName, csrfCookieOptions } from '@/lib/security/csrf'
export const dynamic='force-dynamic'
export async function GET(){const token=randomBytes(32).toString('base64url');const response=NextResponse.json({token});response.cookies.set(csrfCookieName(),token,csrfCookieOptions());return response}
