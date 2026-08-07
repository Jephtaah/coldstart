import { NextResponse } from 'next/server'
import { pool } from '@/lib/db'
import { discoverBusinesses } from '@/lib/discovery'
import { scrapeWebsite } from '@/lib/scraper'
import { generateEmail } from '@/lib/generator'
import { sendBatch } from '@/lib/sender'
import { sendFollowUps } from '@/lib/followup'
import { expandNiches } from '@/lib/expansion'
import { sourceNoWebsiteEmails } from '@/lib/emailfinder'
import {
  MAX_SEO_SCORE_TO_SEND,
  MAX_INITIAL_SENDS_PER_DAY,
  MAX_FOLLOWUPS_PER_DAY,
  MAX_EMAIL_SEARCHES_PER_RUN,
} from '@/lib/constants'
import { Resend } from 'resend'

export const dynamic = 'force-dynamic'

const MAX_NICHES_PER_RUN = 5
const MAX_SCRAPES_PER_RUN = 12
const MAX_GENERATES_PER_RUN = 8
const PENDING_LEAD_STATUSES = ['new', 'scraped', 'generated']

interface StageResult {
  success: boolean
  count?: number
  processed?: number
  error?: string
}

interface RemainingCap {
  initial: number
  followups: number
}

async function getRemainingCap(): Promise<RemainingCap> {
  const settingsResult = await pool.query('SELECT daily_cap, paused FROM settings WHERE id = 1')
  if (settingsResult.rows.length === 0) {
    throw new Error('Settings table row with id = 1 not found.')
  }

  const settings = settingsResult.rows[0]
  if (settings.paused) {
    return { initial: 0, followups: 0 }
  }

  const countResult = await pool.query(
    `SELECT
       (SELECT COUNT(*) FROM leads WHERE initial_sent_at >= CURRENT_DATE) AS initial,
       (SELECT COUNT(*) FROM leads WHERE followup_sent_at >= CURRENT_DATE) AS followups`
  )
  const initialSentToday = parseInt(countResult.rows[0].initial, 10) || 0
  const followupsSentToday = parseInt(countResult.rows[0].followups, 10) || 0

  return {
    initial: Math.min(settings.daily_cap, MAX_INITIAL_SENDS_PER_DAY) - initialSentToday,
    followups: MAX_FOLLOWUPS_PER_DAY - followupsSentToday,
  }
}

export async function GET() {
  const results: Record<string, StageResult> = {}

  // Compute today's remaining send budgets. Initial sends are limited by the
  // daily capacity cap; follow-ups have their own separate budget. If both are
  // spent, skip the run so the pipeline waits for the next day.
  let remaining = Number.MAX_SAFE_INTEGER
  let remainingFollowups = Number.MAX_SAFE_INTEGER
  try {
    const cap = await getRemainingCap()
    remaining = cap.initial
    remainingFollowups = cap.followups
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    results.cap = { success: false, error: message }
  }

  if (remaining <= 0 && remainingFollowups <= 0) {
    await pool.query('UPDATE settings SET last_run_at = NOW() WHERE id = 1')
    return NextResponse.json(
      {
        success: true,
        hasRemaining: false,
        capReached: true,
        results: { cap: { success: true, remaining } },
      },
      { status: 200 }
    )
  }

  // Stage 1: Discovery
  try {
    const nichesResult = await pool.query(
      'SELECT id, label, city FROM niches WHERE status = $1 LIMIT $2',
      ['active', MAX_NICHES_PER_RUN]
    )
    let totalDiscovered = 0
    const errors: string[] = []

    for (const niche of nichesResult.rows) {
      try {
        const count = await discoverBusinesses(niche.label, niche.city, niche.id)
        totalDiscovered += count
        if (count === 0) {
          const pendingResult = await pool.query(
            `SELECT COUNT(*) FROM leads WHERE niche_id = $1 AND status = ANY($2::text[])`,
            [niche.id, PENDING_LEAD_STATUSES]
          )
          const pendingCount = parseInt(pendingResult.rows[0].count, 10)
          if (pendingCount === 0) {
            await pool.query('UPDATE niches SET status = $1 WHERE id = $2', ['exhausted', niche.id])
          }
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err)
        errors.push(`Niche ${niche.label} in ${niche.city}: ${message}`)
      }
    }

    // Check if any active niches remain, if not trigger expandNiches
    let expandedCount = 0
    const activeCheck = await pool.query(
      'SELECT COUNT(*) FROM niches WHERE status = $1',
      ['active']
    )
    if (parseInt(activeCheck.rows[0].count, 10) === 0) {
      try {
        expandedCount = await expandNiches()
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err)
        errors.push(`Niche expansion: ${message}`)
      }
    }

    results.discovery = {
      success: errors.length === 0,
      count: totalDiscovered,
      ...(expandedCount > 0 && { expandedCount }),
      ...(errors.length > 0 && { error: errors.join('; ') }),
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    results.discovery = { success: false, error: message }
  }

  // Stage 2: Scraping
  try {
    const leadsResult = await pool.query(
      'SELECT id FROM leads WHERE status = $1 ORDER BY seo_score ASC NULLS LAST LIMIT $2',
      ['new', MAX_SCRAPES_PER_RUN]
    )
    let scrapedCount = 0
    const errors: string[] = []

    for (const lead of leadsResult.rows) {
      try {
        const success = await scrapeWebsite(lead.id)
        if (success) scrapedCount++
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err)
        errors.push(`Lead ${lead.id}: ${message}`)
      }
    }

    results.scraping = {
      success: errors.length === 0,
      processed: scrapedCount,
      ...(errors.length > 0 && { error: errors.join('; ') }),
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    results.scraping = { success: false, error: message }
  }

  // Stage 2b: Source emails for no-website leads via web search. Leads that get
  // an email move to 'scraped' and flow into generation; leads with no findable
  // email are deleted so the database stays lean.
  try {
    const { sourced, deleted } = await sourceNoWebsiteEmails(MAX_EMAIL_SEARCHES_PER_RUN)
    results.emailSourcing = {
      success: true,
      processed: sourced,
      ...(deleted > 0 && { deleted }),
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    results.emailSourcing = { success: false, error: message }
  }

  // Stage 3: Generation. Leads scoring at/above the SEO cutoff are deleted
  // (and suppressed) rather than stored as 'skipped' — nothing useless is kept.
  try {
    const highScoreResult = await pool.query(
      `SELECT id, place_id FROM leads WHERE status = ANY($1::text[]) AND seo_score >= $2`,
      [['scraped', 'generated'], MAX_SEO_SCORE_TO_SEND]
    )
    let deletedHighScoreCount = 0
    for (const row of highScoreResult.rows) {
      if (row.place_id) {
        await pool.query(
          `INSERT INTO suppressed_places (place_id) VALUES ($1) ON CONFLICT (place_id) DO NOTHING`,
          [row.place_id]
        )
      }
      await pool.query('DELETE FROM leads WHERE id = $1', [row.id])
      deletedHighScoreCount++
    }

    const leadsResult = await pool.query(
      'SELECT id FROM leads WHERE status = $1 ORDER BY seo_score ASC NULLS LAST LIMIT $2',
      ['scraped', MAX_GENERATES_PER_RUN]
    )
    let generatedCount = 0
    const errors: string[] = []

    for (const lead of leadsResult.rows) {
      try {
        const success = await generateEmail(lead.id)
        if (success) generatedCount++
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err)
        errors.push(`Lead ${lead.id}: ${message}`)
      }
    }

    results.generation = {
      success: errors.length === 0,
      processed: generatedCount,
      ...(deletedHighScoreCount > 0 && { deleted: deletedHighScoreCount }),
      ...(errors.length > 0 && { error: errors.join('; ') }),
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    results.generation = { success: false, error: message }
  }

  // Stage 4: Sending Initial Batch
  try {
    const sentCount = await sendBatch()
    results.sending = { success: true, processed: sentCount }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    results.sending = { success: false, error: message }
  }

  // Stage 5: Sending Follow-ups
  try {
    const followupCount = await sendFollowUps()
    results.followups = { success: true, processed: followupCount }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    results.followups = { success: false, error: message }
  }

  // Stage 6: Update last_run_at
  try {
    await pool.query(
      'UPDATE settings SET last_run_at = NOW() WHERE id = 1'
    )
    results.settings = { success: true }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    results.settings = { success: false, error: message }
  }

  // Determine if more work remains so the caller can loop until done
  let hasRemaining = false
  try {
    const pendingResult = await pool.query(
      `SELECT
         (SELECT COUNT(*) FROM leads WHERE status = 'new') AS to_scrape,
         (SELECT COUNT(*) FROM leads WHERE status = 'scraped') AS to_generate,
         (SELECT COUNT(*) FROM niches WHERE status = 'active') AS active_niches`
    )
    const pending = pendingResult.rows[0]
    hasRemaining =
      remaining > 0 &&
      (parseInt(pending.to_scrape, 10) > 0 ||
        parseInt(pending.to_generate, 10) > 0 ||
        parseInt(pending.active_niches, 10) > 0)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    results.settings = { success: false, error: message }
  }

  // Check for failures and send alert email if configured
  const failedStages = Object.entries(results).filter(([, res]) => !res.success || res.error)
  if (failedStages.length > 0 && process.env.RESEND_API_KEY && process.env.REPLY_TO_EMAIL) {
    try {
      const resend = new Resend(process.env.RESEND_API_KEY)
      const senderDomain = process.env.SENDER_DOMAIN || 'example.com'
      const errorSummary = failedStages
        .map(([stage, res]) => `- ${stage}: ${res.error || 'Failed'}`)
        .join('\n')

      await resend.emails.send({
        from: `outreach@${senderDomain}`,
        to: process.env.REPLY_TO_EMAIL,
        subject: '[ColdStart Alert] Pipeline Run Encountered Errors',
        text: `The cold outreach pipeline ran on ${new Date().toISOString()} with errors in the following stages:\n\n${errorSummary}\n\nFull results:\n${JSON.stringify(results, null, 2)}`,
      })
    } catch (alertErr) {
      console.error('Failed to send pipeline error alert email:', alertErr)
    }
  }

  return NextResponse.json({ success: true, hasRemaining, results }, { status: 200 })
}
