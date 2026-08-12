import { createHmac, timingSafeEqual } from 'crypto'

export const DASHBOARD_SESSION_COOKIE = 'coldstart_session'

// Password gate for the operator dashboard (open-source deployments are
// publicly reachable, so the UI itself must not be). The session cookie is
// an HMAC of a fixed label keyed by DASHBOARD_PASSWORD, so any deployment
// with the same password can verify it without server-side session storage,
// and rotating the password invalidates all existing cookies. Fails closed:
// if DASHBOARD_PASSWORD is unset, login and cookie verification both fail.

const SESSION_LABEL = 'coldstart-dashboard-authorized'

function sign(secret: string): string {
  return createHmac('sha256', secret).update(SESSION_LABEL).digest('hex')
}

export function checkPassword(candidate: string): boolean {
  const secret = process.env.DASHBOARD_PASSWORD
  if (!secret || !candidate) return false
  const a = Buffer.from(candidate)
  const b = Buffer.from(secret)
  return a.length === b.length && timingSafeEqual(a, b)
}

export function createSessionToken(): string | null {
  const secret = process.env.DASHBOARD_PASSWORD
  if (!secret) return null
  return sign(secret)
}

export function isValidSessionToken(token: string | undefined): boolean {
  const secret = process.env.DASHBOARD_PASSWORD
  if (!secret || !token) return false
  const expected = sign(secret)
  const a = Buffer.from(token)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}
