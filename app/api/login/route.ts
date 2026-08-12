import { NextResponse } from 'next/server'
import { checkPassword, createSessionToken, DASHBOARD_SESSION_COOKIE } from '@/lib/dashboardAuth'

export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  const password = typeof body?.password === 'string' ? body.password : ''

  if (!process.env.DASHBOARD_PASSWORD) {
    return NextResponse.json(
      { error: 'DASHBOARD_PASSWORD is not configured on the server' },
      { status: 500 }
    )
  }

  if (!checkPassword(password)) {
    return NextResponse.json({ error: 'Incorrect password' }, { status: 401 })
  }

  const token = createSessionToken()
  if (!token) {
    return NextResponse.json({ error: 'Server misconfiguration' }, { status: 500 })
  }

  const response = NextResponse.json({ success: true })
  response.cookies.set(DASHBOARD_SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
  })
  return response
}
