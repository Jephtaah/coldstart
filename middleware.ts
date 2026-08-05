import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export function middleware(request: NextRequest) {
  try {
    const url = request.nextUrl
    const keyParam = url.searchParams.get('key') || 
                     (url.pathname.startsWith('/key=') ? url.pathname.replace('/key=', '') : null) ||
                     (url.pathname.startsWith('/key/') ? url.pathname.replace('/key/', '') : null)

    const authedCookie = request.cookies.get('authed')?.value
    const appSecret = process.env.APP_SECRET

    // Allow API routes (like cron and webhooks) to handle their own authentication
    if (url.pathname.startsWith('/api/')) {
      return NextResponse.next()
    }

    // If secret key is provided and matches APP_SECRET
    if (keyParam && appSecret && keyParam === appSecret) {
      const response = url.pathname.startsWith('/key=') || url.pathname.startsWith('/key/')
        ? NextResponse.redirect(new URL('/', request.url))
        : NextResponse.next()

      response.cookies.set({
        name: 'authed',
        value: 'true',
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
      })
      return response
    }

    // If already authenticated via cookie
    if (authedCookie === 'true') {
      return NextResponse.next()
    }

    // Otherwise return 404
    return new NextResponse('Not Found', { status: 404 })
  } catch (error) {
    console.error('Middleware error:', error)
    return new NextResponse('Internal Error', { status: 500 })
  }
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
