import { NextResponse } from 'next/server'
import { pool } from '@/lib/db'
import { discoverBusinesses, type DiscoverResult } from '@/lib/discovery'
import { expandNiches } from '@/lib/expansion'
import { getPlacesQuotaRemaining } from '@/lib/placesQuota'
import { Resend } from 'resend'

export const dynamic = 'force-dynamic'

const MAX_NICHES_PER_RUN = 5
const PENDING_LEAD_STATUSES = ['new', 'scraped', 'generated']

async function sendDiscoverErrorAlert(summary: string): Promise<void> {
  if (!process.env.RESEND_API_KEY || !process.env.REPLY_TO_EMAIL) return
  try {
    const resend = new Resend(process.env.RESEND_API_KEY)
    const senderDomain = process.env.SENDER_DOMAIN || 'example.com'
    const senderName = process.env.SENDER_NAME
    const fromEmail = senderName ? `${senderName} <outreach@${senderDomain}>` : `outreach@${senderDomain}`
    await resend.emails.send({
      from: fromEmail,
      to: process.env.REPLY_TO_EMAIL,
      subject: '[ColdStart Alert] Discovery Run Encountered Errors',
      text: `The discovery run on ${new Date().toISOString()} reported errors:\n\n${summary}`,
    })
  } catch (alertErr) {
    console.error('Failed to send discovery error alert email:', alertErr)
  }
}

// Discovery runs as a fully independent stage from the rest of the pipeline:
// it only adds new leads from Google Places and manages the niche lifecycle
// (exhaustion + expansion). It enforces a hard daily budget on billable Places
// calls, and when that budget is spent it skips cleanly instead of failing — so
// a quota outage never blocks scraping, generation, or sending elsewhere.
export async function GET() {
  let quotaRemaining = 0
  try {
    quotaRemaining = await getPlacesQuotaRemaining()
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json(
      { success: false, error: `Places quota check failed: ${message}` },
      { status: 500 }
    )
  }

  if (quotaRemaining <= 0) {
    return NextResponse.json({
      success: true,
      skipped: 'quota_exhausted',
      count: 0,
      quotaRemaining: 0,
    })
  }

  try {
    const settingsResult = await pool.query('SELECT paused FROM settings WHERE id = 1')
    if (settingsResult.rows.length === 0) {
      throw new Error('Settings table row with id = 1 not found.')
    }
    if (settingsResult.rows[0].paused) {
      return NextResponse.json({
        success: true,
        skipped: 'paused',
        count: 0,
        quotaRemaining,
      })
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }

  try {
    const nichesResult = await pool.query(
      'SELECT id, label, city FROM niches WHERE status = $1 LIMIT $2',
      ['active', MAX_NICHES_PER_RUN]
    )
    const niches = nichesResult.rows

    let totalDiscovered = 0
    const exhausted: string[] = []
    const errors: string[] = []
    let quotaExhausted = false

    for (const niche of niches) {
      let result: DiscoverResult
      try {
        result = await discoverBusinesses(niche.label, niche.city, niche.id)
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err)
        errors.push(`Niche ${niche.label} in ${niche.city}: ${message}`)
        continue
      }

      totalDiscovered += result.inserted

      // Budget is spent: stop trying further niches for the day. Leads already
      // collected by this run are unaffected.
      if (result.status === 'quota_exhausted') {
        quotaExhausted = true
        break
      }

      // Only a discovery run that actually completed and found nothing new can
      // exhaust a niche — a failed or quota-skipped run never marks it so.
      if (result.inserted === 0) {
        const pendingResult = await pool.query(
          `SELECT COUNT(*) FROM leads WHERE niche_id = $1 AND status = ANY($2::text[])`,
          [niche.id, PENDING_LEAD_STATUSES]
        )
        const pendingCount = parseInt(pendingResult.rows[0].count, 10)
        if (pendingCount === 0) {
          await pool.query('UPDATE niches SET status = $1 WHERE id = $2', ['exhausted', niche.id])
          exhausted.push(`${niche.label} in ${niche.city}`)
        }
      }
    }

    // Check if any active niches remain, if not trigger expandNiches
    let expandedCount = 0
    const activeCheck = await pool.query('SELECT COUNT(*) FROM niches WHERE status = $1', ['active'])
    if (parseInt(activeCheck.rows[0].count, 10) === 0) {
      try {
        expandedCount = await expandNiches()
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err)
        errors.push(`Niche expansion: ${message}`)
      }
    }

    if (quotaExhausted) {
      try {
        quotaRemaining = await getPlacesQuotaRemaining()
      } catch {
        quotaRemaining = 0
      }
    }

    // Only genuine failures warrant an alert. A quota-exhausted or paused run
    // is expected and reported as a clean skip, not an error.
    if (errors.length > 0) {
      await sendDiscoverErrorAlert(errors.join('\n'))
    }

    return NextResponse.json({
      success: errors.length === 0,
      count: totalDiscovered,
      quotaRemaining,
      ...(exhausted.length > 0 && { exhausted }),
      ...(expandedCount > 0 && { expandedCount }),
      ...(quotaExhausted && { quotaExhausted: true }),
      ...(errors.length > 0 && { error: errors.join('; ') }),
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    await sendDiscoverErrorAlert(message)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
