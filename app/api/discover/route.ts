import { NextResponse } from 'next/server'
import { pool } from '@/lib/db'
import { discoverBusinesses, type DiscoverResult } from '@/lib/discovery'
import { expandNiches } from '@/lib/expansion'
import { getPlacesQuotaRemaining } from '@/lib/placesQuota'
import { recordError } from '@/lib/errors'
import { requireCronAuth } from '@/lib/cronAuth'
import { MAX_NICHES_PER_RUN } from '@/lib/constants'

export const dynamic = 'force-dynamic'

const PENDING_LEAD_STATUSES = ['new', 'scraped', 'generated', 'no_website']

// Discovery runs as a fully independent stage from the rest of the pipeline:
// it only adds new leads from Google Places and manages the niche lifecycle
// (exhaustion + expansion). It enforces a hard daily budget on billable Places
// calls, and when that budget is spent it skips cleanly instead of failing — so
// a quota outage never blocks scraping, generation, or sending elsewhere.
export async function GET(request: Request) {
  const authError = requireCronAuth(request)
  if (authError) return authError

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
    const partial: string[] = []
    const errors: string[] = []
    let quotaExhausted = false

    for (const niche of niches) {
      let result: DiscoverResult
      try {
        result = await discoverBusinesses(niche.label, niche.city, niche.id)
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err)
        const recorded = await recordError({
          source: 'discover',
          stage: 'discovery',
          message: `Niche ${niche.label} in ${niche.city}`,
          context: { error: message },
        })
        if (!recorded) {
          console.error(`Error persistence failed for discover/discovery: ${message}`)
        }
        errors.push(`Niche ${niche.label} in ${niche.city}: ${message}`)
        continue
      }

      totalDiscovered += result.inserted

      // Budget is spent: stop trying further niches for the day. Leads already
      // collected by this run are unaffected. A 403 config error on Google's
      // side is surfaced here so the run reports an error and alerts instead
      // of silently skipping for the rest of the day.
      if (result.status === 'quota_exhausted') {
        quotaExhausted = true
        if (result.error) {
          const recorded = await recordError({
            source: 'discover',
            stage: 'discovery',
            message: `Niche ${niche.label} in ${niche.city}`,
            context: { error: result.error },
          })
          if (!recorded) {
            console.error(`Error persistence failed for discover/discovery: ${result.error}`)
          }
          errors.push(`Niche ${niche.label} in ${niche.city}: ${result.error}`)
        }
        break
      }

      // A run stopped by a transient pagination error is partial: it neither
      // proves the niche is dry nor exhausts it. Record it so a persistent
      // Google Places outage shows up on the dashboard instead of silently
      // discovering nothing every day.
      if (result.status === 'partial') {
        const partialMsg = `Niche ${niche.label} in ${niche.city} stopped early on a transient Places fetch error; will retry next run.`
        partial.push(`${niche.label} in ${niche.city}`)
        const recorded = await recordError({
          source: 'discover',
          stage: 'discovery',
          message: partialMsg,
        })
        if (!recorded) {
          console.error(`Error persistence failed for discover/discovery: ${partialMsg}`)
        }
        continue
      }

      // Only a discovery run that actually completed and found nothing new can
      // exhaust a niche — a failed, partial, or quota-skipped run never marks
      // it so.
      if (result.inserted === 0 && result.status === 'ok') {
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
        // expandNiches swallows AI failures and returns 0. With no active
        // niches left, discovery would silently do nothing forever — surface
        // it so the run is flagged instead of stalling.
        if (expandedCount === 0) {
          const message = 'Niche expansion produced no new niches; no active niches remain.'
          const recorded = await recordError({
            source: 'discover',
            stage: 'niche_expansion',
            message,
          })
          if (!recorded) {
            console.error(`Error persistence failed for discover/niche_expansion: ${message}`)
          }
          errors.push(`Niche expansion: ${message}`)
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err)
        const recorded = await recordError({
          source: 'discover',
          stage: 'niche_expansion',
          message,
        })
        if (!recorded) {
          console.error(`Error persistence failed for discover/niche_expansion: ${message}`)
        }
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

    // Genuine failures are recorded per-stage above as they happen; a
    // quota-exhausted or paused run is expected and reported as a clean skip,
    // not an error.

    return NextResponse.json({
      success: errors.length === 0,
      count: totalDiscovered,
      quotaRemaining,
      ...(exhausted.length > 0 && { exhausted }),
      ...(partial.length > 0 && { partial }),
      ...(expandedCount > 0 && { expandedCount }),
      ...(quotaExhausted && { quotaExhausted: true }),
      ...(errors.length > 0 && { error: errors.join('; ') }),
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    const recorded = await recordError({
      source: 'discover',
      stage: 'run',
      message,
    })
    if (!recorded) {
      console.error(`Error persistence failed for discover/run: ${message}`)
    }
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
