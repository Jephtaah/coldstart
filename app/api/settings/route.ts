import { NextResponse } from 'next/server'
import { pool } from '@/lib/db'
import { MAX_DAILY_CAP } from '@/lib/constants'

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { action } = body

    if (action === 'update_settings') {
      const { daily_cap, paused } = body
      const cap = parseInt(daily_cap, 10)
      if (isNaN(cap) || cap < 1) {
        return NextResponse.json({ error: 'Invalid daily cap' }, { status: 400 })
      }
      if (cap > MAX_DAILY_CAP) {
        return NextResponse.json({ error: `Daily cap cannot exceed Resend's ${MAX_DAILY_CAP}/day free tier ceiling` }, { status: 400 })
      }
      const isPaused = Boolean(paused)

      await pool.query(
        `insert into settings (id, daily_cap, paused) values (1, $1, $2)
         on conflict (id) do update set daily_cap = excluded.daily_cap, paused = excluded.paused`,
        [cap, isPaused]
      )

      return NextResponse.json({ success: true })
    }

    if (action === 'save_targeting') {
      const { industries, cities } = body as { industries: string[]; cities: string[] }

      if (!Array.isArray(industries) || !Array.isArray(cities) || industries.length < 3 || cities.length < 3) {
        return NextResponse.json(
          { error: 'You must select at least 3 industries and 3 cities.' },
          { status: 400 }
        )
      }

      // 1. Get all existing niches
      const existingResult = await pool.query('select id, label, city, status, source from niches')
      const existingNiches = existingResult.rows

      // 2. For every pair of selected industry and city, ensure an active niche exists
      for (const industry of industries) {
        for (const city of cities) {
          const found = existingNiches.find(
            (n) => n.label.toLowerCase() === industry.toLowerCase() && n.city.toLowerCase() === city.toLowerCase()
          )

          if (found) {
            // Update to active if it was exhausted
            if (found.status !== 'active') {
              await pool.query('update niches set status = $1 where id = $2', ['active', found.id])
            }
          } else {
            // Insert new seed niche
            await pool.query(
              'insert into niches (label, city, status, source) values ($1, $2, $3, $4)',
              [industry, city, 'active', 'seed']
            )
          }
        }
      }

      // 3. For seed niches that are no longer in the selected combination grid, set status to 'exhausted' (or leave custom/ai ones alone)
      for (const n of existingNiches) {
        if (n.source === 'seed' || n.source === 'ai_suggested') {
          const inSelectedGrid = industries.some(
            (ind) => ind.toLowerCase() === n.label.toLowerCase()
          ) && cities.some(
            (cit) => cit.toLowerCase() === n.city.toLowerCase()
          )

          if (!inSelectedGrid && n.status === 'active') {
            await pool.query('update niches set status = $1 where id = $2', ['exhausted', n.id])
          }
        }
      }

      return NextResponse.json({ success: true })
    }

    if (action === 'add_custom_niche') {
      const { label, city } = body
      if (!label || !city) {
        return NextResponse.json({ error: 'Label and city are required' }, { status: 400 })
      }

      await pool.query(
        'insert into niches (label, city, status, source) values ($1, $2, $3, $4)',
        [label.trim(), city.trim(), 'active', 'seed']
      )

      return NextResponse.json({ success: true })
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (error: unknown) {
    console.error('Settings API error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}
