import { NextResponse } from 'next/server'
import { pool } from '@/lib/db'
import { discoverBusinesses } from '@/lib/discovery'
import { scrapeWebsite } from '@/lib/scraper'
import { generateEmail } from '@/lib/generator'
import { sendBatch } from '@/lib/sender'
import { sendFollowUps } from '@/lib/followup'
import { expandNiches } from '@/lib/expansion'

export const dynamic = 'force-dynamic'

interface StageResult {
  success: boolean
  count?: number
  processed?: number
  error?: string
}

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET
  const authHeader = request.headers.get('x-cron-secret')

  if (!cronSecret || authHeader !== cronSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const results: Record<string, StageResult> = {}

  // Stage 1: Discovery
  try {
    const nichesResult = await pool.query(
      'SELECT id, label, city FROM niches WHERE status = $1',
      ['active']
    )
    let totalDiscovered = 0
    const errors: string[] = []

    for (const niche of nichesResult.rows) {
      try {
        const count = await discoverBusinesses(niche.label, niche.city, niche.id)
        totalDiscovered += count
        if (count === 0) {
          await pool.query('UPDATE niches SET status = $1 WHERE id = $2', ['exhausted', niche.id])
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
      'SELECT id FROM leads WHERE status = $1',
      ['new']
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

  // Stage 3: Generation
  try {
    const leadsResult = await pool.query(
      'SELECT id FROM leads WHERE status = $1',
      ['scraped']
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

  return NextResponse.json({ success: true, results }, { status: 200 })
}
