import { pool } from './db'
import { MAX_PLACES_CALLS_PER_DAY } from './constants'

// Daily budget for Google Places API calls. Every page fetched during
// discovery bills one request, so usage is tracked per calendar day (using the
// database server's current date, matching how the daily send cap is counted)
// and rolled over automatically when the date changes.
//
// Requires the settings columns added by docs/sql/add-places-budget.sql.

export async function getPlacesQuotaRemaining(): Promise<number> {
  try {
    const result = await pool.query(
      `SELECT COALESCE(
         CASE WHEN places_used_date = CURRENT_DATE THEN places_used_count ELSE 0 END,
         0
       )::int AS used
       FROM settings WHERE id = 1`
    )
    if (result.rows.length === 0) {
      throw new Error('Settings table row with id = 1 not found.')
    }
    const used = parseInt(result.rows[0].used, 10) || 0
    return Math.max(0, MAX_PLACES_CALLS_PER_DAY - used)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    throw new Error(
      `Google Places quota is unavailable (run docs/sql/add-places-budget.sql first): ${message}`
    )
  }
}

// Atomically reserves `count` calls against today's budget. Returns false when
// doing so would exceed the daily cap; a rejected reservation consumes nothing,
// so the caller should stop calling Google for the rest of the day.
export async function consumePlacesQuota(count: number): Promise<boolean> {
  const result = await pool.query(
    `UPDATE settings
     SET places_used_count = CASE
         WHEN places_used_date = CURRENT_DATE THEN places_used_count + $1
         ELSE $1
       END,
       places_used_date = CURRENT_DATE
     WHERE id = 1
       AND CASE
         WHEN places_used_date = CURRENT_DATE THEN places_used_count + $1 <= $2
         ELSE $1 <= $2
       END`,
    [count, MAX_PLACES_CALLS_PER_DAY]
  )
  return (result.rowCount ?? 0) > 0
}
