import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

const PUBLIC_ROUTES = ['/login', '/register', '/verify-email']

/**
 * Lightweight JWT structure check (no crypto — Edge Runtime safe).
 * Verifies the token is a well-formed JWT with a non-expired `exp` claim.
 * Full signature verification happens on the backend for every API call.
 */
function isJwtStructurallyValid(token: string): boolean {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return false

    // Decode payload (base64url → JSON)
    const padded = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const json = atob(padded.padEnd(padded.length + (4 - padded.length % 4) % 4, '='))
    const payload = JSON.parse(json)

    // Must have a subject
    if (!payload.sub) return false

    // Must be an access token — reject refresh tokens used as access tokens
    if (payload.type && payload.type !== 'access') return false

    // Must not be expired (exp is Unix seconds)
    if (payload.exp && Date.now() / 1000 > payload.exp) return false

    return true
  } catch {
    return false
  }
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Allow public routes and static assets
  if (
    PUBLIC_ROUTES.some(r => pathname.startsWith(r)) ||
    pathname.startsWith('/_next') ||
    pathname.startsWith('/api') ||
    pathname.includes('.')
  ) {
    return NextResponse.next()
  }

  const authCookie = request.cookies.get('aic_auth')
  const token = authCookie?.value

  // No cookie or cookie is not a valid JWT structure → redirect to login
  if (!token || !isJwtStructurallyValid(token)) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    url.searchParams.set('redirect', pathname)
    // Clear a stale/invalid cookie if present
    const response = NextResponse.redirect(url)
    if (token) response.cookies.delete('aic_auth')
    return response
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
