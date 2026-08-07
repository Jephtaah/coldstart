import { pool } from './db'

export type SuppressionReason = 'bounce' | 'complaint'

export function normalizeEmail(email: string | null | undefined): string | null {
  if (!email) return null
  const trimmed = email.trim().toLowerCase()
  return trimmed === '' ? null : trimmed
}

// Record a permanently undeliverable or complained-about address so it can
// never enter the pipeline again, no matter how it is re-discovered.
export async function suppressEmail(
  email: string | null | undefined,
  reason: SuppressionReason
): Promise<void> {
  const normalized = normalizeEmail(email)
  if (!normalized) return
  await pool.query(
    `INSERT INTO suppressed_emails (email, reason) VALUES ($1, $2) ON CONFLICT (email) DO NOTHING`,
    [normalized, reason]
  )
}

export async function isSuppressedEmail(email: string | null | undefined): Promise<boolean> {
  const normalized = normalizeEmail(email)
  if (!normalized) return false
  const result = await pool.query(`SELECT 1 FROM suppressed_emails WHERE email = $1`, [normalized])
  return result.rows.length > 0
}
