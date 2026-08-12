import { NextRequest, NextResponse } from 'next/server'
import { DASHBOARD_SESSION_COOKIE, isValidSessionToken } from '@/lib/dashboardAuth'

// Gates the operator dashboard and its settings API behind DASHBOARD_PASSWORD.
// /api/discover and /api/run-pipeline use their own CRON_SECRET header auth
// (see lib/cronAuth.ts) since GitHub Actions calls them without a browser
// session. /api/webhooks/* stays open since Resend calls it directly and
// verifies its own HMAC signature.

export function proxy(request: NextRequest) {
  const token = request.cookies.get(DASHBOARD_SESSION_COOKIE)?.value
  if (isValidSessionToken(token)) return NextResponse.next()

  if (request.nextUrl.pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const loginUrl = new URL('/login', request.url)
  return NextResponse.redirect(loginUrl)
}

export const config = {
  matcher: ['/dashboard/:path*', '/api/settings/:path*'],
}
