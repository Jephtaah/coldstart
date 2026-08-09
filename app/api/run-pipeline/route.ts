import { NextResponse } from 'next/server'
import { pool } from '@/lib/db'
import { scrapeWebsite } from '@/lib/scraper'
import { generateEmail } from '@/lib/generator'
import { getAiApiKey, AiUnavailableError } from '@/lib/ai'
import { sendBatch } from '@/lib/sender'
import { sendFollowUps } from '@/lib/followup'
import { sourceNoWebsiteEmails } from '@/lib/emailfinder'
import {
  MAX_SEO_SCORE_TO_SEND,
  MAX_INITIAL_SENDS_PER_DAY,
  MAX_FOLLOWUPS_PER_DAY,
  MAX_EMAIL_SEARCHES_PER_RUN,
  MAX_SENDS_PER_RUN,
  MAX_FOLLOWUPS_PER_RUN,
  MAX_SCRAPES_PER_RUN,
  MAX_GENERATES_PER_RUN,
  RUN_BUDGET_MS,
  FOLLOWUP_DELAY_INTERVAL,
  BOUNCE_ALERT_THRESHOLD,
  COMPLAINT_ALERT_THRESHOLD,
} from '@/lib/constants'
import { recordError } from '@/lib/errors'
import { requireCronAuth } from '@/lib/cronAuth'

export const dynamic = 'force-dynamic'

interface StageResult {
  success: boolean
  count?: number
  processed?: number
  error?: string
  bounces?: number
  complaints?: number
}

interface RemainingCap {
  initial: number
  followups: number
}

// A lead that throws while being processed would otherwise stay in its current
// status and keep `hasRemaining` true forever, making the workflow loop spin
// through its max iterations every day. Moving it to 'failed' (best effort)
// takes it out of the work queues; failed leads are intentionally kept for
// inspection on the dashboard.
async function failLead(leadId: string): Promise<void> {
  try {
    await pool.query('UPDATE leads SET status = $1 WHERE id = $2', ['failed', leadId])
  } catch (err: unknown) {
    console.error(`Failed to mark lead ${leadId} as failed:`, err)
  }
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

async function runSendHealthMonitor(): Promise<StageResult> {
  try {
    const monitorResult = await pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE reason = 'bounce' AND created_at > NOW() - INTERVAL '24 hours') AS bounces,
         COUNT(*) FILTER (WHERE reason = 'complaint' AND created_at > NOW() - INTERVAL '24 hours') AS complaints
       FROM suppressed_emails`
    )
    const bounces = parseInt(monitorResult.rows[0].bounces, 10) || 0
    const complaints = parseInt(monitorResult.rows[0].complaints, 10) || 0

    const issues: string[] = []
    if (bounces >= BOUNCE_ALERT_THRESHOLD) {
      issues.push(`${bounces} bounces in the last 24 hours (threshold ${BOUNCE_ALERT_THRESHOLD})`)
    }
    if (complaints >= COMPLAINT_ALERT_THRESHOLD) {
      issues.push(
        `${complaints} spam complaint(s) in the last 24 hours (threshold ${COMPLAINT_ALERT_THRESHOLD})`
      )
    }

    return issues.length === 0
      ? { success: true, bounces, complaints }
      : { success: false, bounces, complaints, error: issues.join('; ') }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return { success: false, error: message }
  }
}

async function updateLastRunAt(): Promise<StageResult> {
  try {
    await pool.query('UPDATE settings SET last_run_at = NOW() WHERE id = 1')
    return { success: true }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return { success: false, error: message }
  }
}

async function computeHasRemaining(
  remaining: number,
  remainingFollowups: number
): Promise<boolean> {
  // Only work this route can do on its own: drain the send/follow-up backlogs
  // and process leads already in the database. Discovery lives in its own
  // endpoint (/api/discover) and never gates the pipeline loop, so a Places
  // quota outage can't keep this route spinning.
  const pendingResult = await pool.query(
    `SELECT
       (SELECT COUNT(*) FROM leads WHERE status = 'new') AS to_scrape,
       (SELECT COUNT(*) FROM leads WHERE status = 'scraped') AS to_generate,
       (SELECT COUNT(*) FROM leads WHERE status = 'no_website') AS to_source_email,
       (SELECT COUNT(*) FROM leads
        WHERE status = 'generated' AND (seo_score IS NULL OR seo_score < $1)
          AND NOT EXISTS (SELECT 1 FROM suppressed_emails se WHERE se.email = lower(leads.email))) AS to_send,
        (SELECT COUNT(*) FROM leads
        WHERE status = 'sent' AND initial_sent_at <= NOW() - $2::interval AND followup_sent_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM suppressed_emails se WHERE se.email = lower(leads.email))) AS to_followup`,
    [MAX_SEO_SCORE_TO_SEND, FOLLOWUP_DELAY_INTERVAL]
  )
  const pending = pendingResult.rows[0]
  const hasSendWork = remaining > 0 && parseInt(pending.to_send, 10) > 0
  const hasFollowupWork = remainingFollowups > 0 && parseInt(pending.to_followup, 10) > 0
  const hasProduceWork =
    remaining > 0 &&
    (parseInt(pending.to_scrape, 10) > 0 ||
      parseInt(pending.to_generate, 10) > 0 ||
      parseInt(pending.to_source_email, 10) > 0)
  return hasSendWork || hasFollowupWork || hasProduceWork
}

// Persists every failed stage of a run to the errors table so the operator can
// review them on the dashboard. Runs after a run completes, so all failures are
// recorded even when a stage throws early.
async function recordStageErrors(results: Record<string, StageResult>): Promise<void> {
  for (const [stage, res] of Object.entries(results)) {
    if (!res.success || res.error) {
      const recorded = await recordError({
        source: 'pipeline',
        stage,
        message: res.error || 'Stage failed without an error message',
        context: {
          processed: res.processed ?? null,
          count: res.count ?? null,
          bounces: res.bounces ?? null,
          complaints: res.complaints ?? null,
        },
      })
      if (!recorded) {
        console.error(`Error persistence failed for pipeline/${stage}: ${res.error || 'unknown'}`)
      }
    }
  }
}

async function getSendBacklog(): Promise<{ toSend: number; toFollowup: number }> {
  const gateResult = await pool.query(
    `SELECT
       (SELECT COUNT(*) FROM leads
        WHERE status = 'generated' AND (seo_score IS NULL OR seo_score < $1)
          AND NOT EXISTS (SELECT 1 FROM suppressed_emails se WHERE se.email = lower(leads.email))) AS to_send,
        (SELECT COUNT(*) FROM leads
        WHERE status = 'sent' AND initial_sent_at <= NOW() - $2::interval AND followup_sent_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM suppressed_emails se WHERE se.email = lower(leads.email))) AS to_followup`,
    [MAX_SEO_SCORE_TO_SEND, FOLLOWUP_DELAY_INTERVAL]
  )
  return {
    toSend: parseInt(gateResult.rows[0].to_send, 10) || 0,
    toFollowup: parseInt(gateResult.rows[0].to_followup, 10) || 0,
  }
}

// Removes generated leads whose address has since been suppressed (bounced or
// complained via webhook). The send query already excludes them, so without this
// they would linger in 'generated' forever — invisible in the backlog and never
// cleaned up. Suppressed addresses are preserved in suppressed_emails, so the
// row deletion is safe.
async function cleanupSuppressedGenerated(): Promise<number> {
  const result = await pool.query(
    `DELETE FROM leads
     WHERE status = 'generated'
       AND EXISTS (SELECT 1 FROM suppressed_emails se WHERE se.email = lower(leads.email))
     RETURNING id`
  )
  return result.rowCount ?? 0
}

// True once the invocation has spent its soft wall-clock budget. Stages use this
// to stop starting new units of work (individual scrapes, generations, etc.) so
// the function returns well inside Vercel's serverless timeout on the Hobby
// plan. The workflow loop then calls back and picks up the rest.
function budgetExhausted(startedAt: number): boolean {
  return Date.now() - startedAt >= RUN_BUDGET_MS
}

export async function GET(request: Request) {
  const authError = requireCronAuth(request)
  if (authError) return authError

  const startedAt = Date.now()
  const results: Record<string, StageResult> = {}

  // Compute today's remaining send budgets. Initial sends are limited by the
  // daily capacity cap; follow-ups have their own separate budget. If both are
  // spent, skip the run so the pipeline waits for the next day. A failure here
  // must fail the run rather than proceed with unlimited budgets, which could
  // otherwise let a single day blow through the entire send capacity.
  let remaining = 0
  let remainingFollowups = 0
  try {
    const cap = await getRemainingCap()
    remaining = cap.initial
    remainingFollowups = cap.followups
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    results.cap = { success: false, error: message }
    await recordStageErrors(results)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
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

  // Send gate: when there is a backlog waiting to go out (generated leads
  // within the cap, or follow-ups due), this invocation only drains a bounded
  // sub-batch with 20-40s spacing and returns, letting the workflow loop come
  // back for more. Production stages run only when the gate is clear, so a
  // single invocation never both generates a large backlog and sends it.
  let toSend = 0
  let toFollowup = 0
  try {
    const backlog = await getSendBacklog()
    toSend = backlog.toSend
    toFollowup = backlog.toFollowup
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    results.gate = { success: false, error: message }
    await recordStageErrors(results)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }

  const canSendInitial = remaining > 0 && toSend > 0
  const canSendFollowups = remainingFollowups > 0 && toFollowup > 0

  // Always purge generated leads whose email is suppressed, so they don't
  // accumulate invisibly regardless of which mode this invocation takes.
  try {
    const purged = await cleanupSuppressedGenerated()
    if (purged > 0) {
      results.cleanup = { success: true, processed: purged }
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    results.cleanup = { success: false, error: message }
  }

  if (canSendInitial || canSendFollowups) {
    // Send mode: trickle out the backlog, never producing while a drain is
    // underway so each invocation stays safely inside the function timeout.
    if (canSendInitial) {
      try {
        const { sent, rejected } = await sendBatch(MAX_SENDS_PER_RUN, () =>
          budgetExhausted(startedAt)
        )
        results.sending = {
          success: rejected.length === 0,
          processed: sent,
          ...(rejected.length > 0 && { error: rejected.join('; ') }),
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err)
        results.sending = { success: false, error: message }
      }
    }

    if (canSendFollowups) {
      try {
        const { sent, rejected } = await sendFollowUps(MAX_FOLLOWUPS_PER_RUN, () =>
          budgetExhausted(startedAt)
        )
        results.followups = {
          success: rejected.length === 0,
          processed: sent,
          ...(rejected.length > 0 && { error: rejected.join('; ') }),
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err)
        results.followups = { success: false, error: message }
      }
    }

    results.sendHealth = await runSendHealthMonitor()
    results.settings = await updateLastRunAt()

    let hasRemaining = false
    try {
      hasRemaining = await computeHasRemaining(remaining, remainingFollowups)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      results.hasRemaining = { success: false, error: message }
    }

    await recordStageErrors(results)

    return NextResponse.json(
      { success: true, sendMode: true, hasRemaining, results },
      { status: 200 }
    )
  }

  // Produce mode: refill the pipeline from leads already in the database. No
  // sending happens here — newly generated leads are picked up by the send gate
  // on a later invocation. Discovery of new businesses is a separate concern
  // handled by /api/discover, so this route never depends on Google Places.
  // Refilling only runs while there is still initial-send capacity left today;
  // otherwise it would build a backlog that can't go out until the cap resets
  // and then report "no work remains" in the same run.
  if (remaining > 0) {
    // Stage 1: Scraping
    try {
      const leadsResult = await pool.query(
        'SELECT id FROM leads WHERE status = $1 ORDER BY seo_score ASC NULLS LAST LIMIT $2',
        ['new', MAX_SCRAPES_PER_RUN]
      )
      let scrapedCount = 0
      const errors: string[] = []

      for (const lead of leadsResult.rows) {
        if (budgetExhausted(startedAt)) break
        try {
          const success = await scrapeWebsite(lead.id)
          if (success) scrapedCount++
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err)
          errors.push(`Lead ${lead.id}: ${message}`)
          await failLead(lead.id)
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

    // Stage 2: Source emails for no-website leads via web search. Leads that get
    // an email move to 'scraped' and flow into generation; leads with no findable
    // email are deleted so the database stays lean.
    try {
      const { sourced, deleted, failures } = await sourceNoWebsiteEmails(
        MAX_EMAIL_SEARCHES_PER_RUN,
        () => budgetExhausted(startedAt)
      )
      results.emailSourcing = {
        success: failures.length === 0,
        processed: sourced,
        ...(deleted > 0 && { deleted }),
        ...(failures.length > 0 && { error: failures.join('; ') }),
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
        `SELECT l.id FROM leads l
         WHERE l.status = $1
           AND NOT EXISTS (SELECT 1 FROM suppressed_emails se WHERE se.email = lower(l.email))
         ORDER BY l.seo_score ASC NULLS LAST LIMIT $2`,
        ['scraped', MAX_GENERATES_PER_RUN]
      )
      let generatedCount = 0
      const errors: string[] = []

      if (!getAiApiKey()) {
        // A missing key is a config error, not a lead problem: surface it once
        // and leave the scraped leads queued. Failing them all here would
        // permanently destroy the queue for no fault of the leads.
        errors.push('DEEPSEEK_API_KEY or AI_API_KEY is not set in environment variables.')
      } else {
      for (const lead of leadsResult.rows) {
        if (budgetExhausted(startedAt)) break
        try {
          const success = await generateEmail(lead.id)
          if (success) generatedCount++
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err)
          errors.push(`Lead ${lead.id}: ${message}`)
          // An AI provider failure is not the lead's fault: keep it queued so a
          // later run retries generation instead of permanently losing a valid
          // outreach target. Other failures (e.g. DB errors) fail the lead so
          // it leaves the work queue.
          if (!(err instanceof AiUnavailableError)) {
            await failLead(lead.id)
          }
        }
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
  }

  results.sendHealth = await runSendHealthMonitor()
  results.settings = await updateLastRunAt()

  let hasRemaining = false
  try {
    hasRemaining = await computeHasRemaining(remaining, remainingFollowups)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    results.hasRemaining = { success: false, error: message }
  }

  await recordStageErrors(results)

  return NextResponse.json({ success: true, hasRemaining, results }, { status: 200 })
}
