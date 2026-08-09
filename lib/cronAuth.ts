import { NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'

const CRON_SECRET_HEADER = 'x-cron-secret'

// Shared-secret auth for the automation endpoints (/api/discover,
// /api/run-pipeline). The caller must present the same CRON_SECRET value in a
// header, which the GitHub Actions cron does. Fails closed: if CRON_SECRET is
// unset, nothing is authorized. (/api/settings is deliberately left open for
// the single-operator dashboard.)

export function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  const provided = request.headers.get(CRON_SECRET_HEADER) ?? ''
  const a = Buffer.from(provided)
  const b = Buffer.from(secret)
  return a.length === b.length && timingSafeEqual(a, b)
}

export function requireCronAuth(request: Request): NextResponse | null {
  if (isAuthorized(request)) return null
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
}
