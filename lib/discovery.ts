import { pool } from './db'
import { scoreDiscoverySignals } from './seo'
import { consumePlacesQuota } from './placesQuota'
import {
  MAX_PLACES_PAGES_PER_NICHE,
  PLACES_PAGES_TO_SKIP,
  MAX_SEO_SCORE_TO_SEND,
  PLACES_TIMEOUT_MS,
  PLACES_PAGE_DELAY_MS,
} from './constants'

interface GooglePlace {
  id: string
  displayName?: {
    text: string
  }
  formattedAddress?: string
  websiteUri?: string
  rating?: number
  userRatingCount?: number
}

interface PlacesSearchResponse {
  places?: GooglePlace[]
  nextPageToken?: string
}

interface PlaceWithPage {
  place: GooglePlace
  pageIndex: number
}

// 'ok' — pagination completed cleanly (this is the only status that can prove a
//        niche is genuinely dry).
// 'partial' — a transient non-quota fetch error stopped pagination before it
//        finished, so the run proves nothing about exhaustion.
// 'quota_exhausted' — the daily Places budget ran out mid-run.
export type DiscoveryStatus = 'ok' | 'partial' | 'quota_exhausted'

export interface DiscoverResult {
  inserted: number
  status: DiscoveryStatus
  // Set when Google rejected a request in a way the operator needs to know
  // about (HTTP 403 — API/billing not enabled) even though pagination stops.
  error?: string
}

// Thrown when Google replies with a quota/rate-limit response (429 = rate
// limit, 403 = billing/API not enabled). Distinct from ordinary request
// failures so discovery can stop immediately instead of hammering the API for
// the rest of the day. `status` carries the HTTP code so callers can decide
// whether a 403 config problem should surface as an error instead of a quiet
// skip.
export class PlacesQuotaError extends Error {
  readonly status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

const FIELDMASK =
  'places.id,places.displayName,places.formattedAddress,places.websiteUri,places.rating,places.userRatingCount,nextPageToken'

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function fetchPlacesPage(
  textQuery: string,
  pageToken: string | undefined,
  apiKey: string
): Promise<PlacesSearchResponse> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), PLACES_TIMEOUT_MS)

  try {
    const response = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': FIELDMASK,
      },
      body: JSON.stringify(pageToken ? { textQuery, pageToken } : { textQuery }),
      signal: controller.signal,
    })

    if (!response.ok) {
      const body = await response.text()
      if (response.status === 429 || response.status === 403) {
        throw new PlacesQuotaError(
          `Google Places API quota/rate-limit error (${response.status}): ${body}`,
          response.status
        )
      }
      throw new Error(
        `Google Places API request failed with status ${response.status}: ${body}`
      )
    }

    return (await response.json()) as PlacesSearchResponse
  } catch (err: unknown) {
    if (err instanceof PlacesQuotaError) {
      throw err
    }
    throw new Error(
      `Google Places API network error or timeout: ${err instanceof Error ? err.message : String(err)}`
    )
  } finally {
    clearTimeout(timeoutId)
  }
}

export async function discoverBusinesses(
  nicheLabel: string,
  city: string,
  nicheId: string
): Promise<DiscoverResult> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY
  if (!apiKey) {
    throw new Error('GOOGLE_PLACES_API_KEY is not set in environment variables.')
  }

  const textQuery = `${nicheLabel} in ${city}`
  const collected: PlaceWithPage[] = []
  let pageToken: string | undefined
  let status: DiscoveryStatus = 'ok'
  let resultError: string | undefined

  for (let page = 0; page < MAX_PLACES_PAGES_PER_NICHE; page++) {
    // Every page fetch bills one Places request, so reserve it against the
    // daily budget before calling Google. When the budget is spent, stop
    // paginating immediately; leads already collected still get inserted.
    const reserved = await consumePlacesQuota(1)
    if (!reserved) {
      status = 'quota_exhausted'
      break
    }

    try {
      const data = await fetchPlacesPage(textQuery, pageToken, apiKey)
      // Ignore the first PLACES_PAGES_TO_SKIP pages entirely (Google ranks
      // them by prominence, so they hold the businesses that don't need us).
      if (page >= PLACES_PAGES_TO_SKIP) {
        for (const place of data.places || []) {
          collected.push({ place, pageIndex: page })
        }
      }
      pageToken = data.nextPageToken
      if (!pageToken) break
    } catch (err: unknown) {
      if (err instanceof PlacesQuotaError) {
        status = 'quota_exhausted'
        // A 403 is a config problem (billing/API not enabled) that won't
        // self-resolve tomorrow — surface it so the operator is alerted.
        // A 429 is a transient rate limit and stays a quiet skip.
        if (err.status === 403) {
          resultError = err.message
        }
        break
      }
      console.error(`Places pagination stopped at page ${page + 1}:`, err)
      status = 'partial'
      break
    }

    if (page < MAX_PLACES_PAGES_PER_NICHE - 1) {
      await sleep(PLACES_PAGE_DELAY_MS)
    }
  }

  const seen = new Set<string>()
  const uniquePlaces = collected.filter(({ place }) => {
    if (seen.has(place.id)) return false
    seen.add(place.id)
    return true
  })

  // Keep every business with a name/id, including ones without a website.
  // No-website businesses are stored with status 'no_website' and get an email
  // via search-based sourcing later (see lib/emailfinder.ts).
  const validPlaces = uniquePlaces.filter(
    ({ place }) => place.id && place.displayName?.text
  )
  if (validPlaces.length === 0) {
    return { inserted: 0, status, ...(resultError && { error: resultError }) }
  }

  const placeIds = validPlaces.map(({ place }) => place.id)

  // Batch query existing place_ids
  const existingResult = await pool.query(
    'SELECT place_id FROM leads WHERE place_id = ANY($1)',
    [placeIds]
  )
  const suppressedResult = await pool.query(
    'SELECT place_id FROM suppressed_places WHERE place_id = ANY($1)',
    [placeIds]
  )
  const existingSet = new Set([
    ...existingResult.rows.map((row) => row.place_id),
    ...suppressedResult.rows.map((row) => row.place_id),
  ])

  let newLeadsCount = 0

  for (const { place, pageIndex } of validPlaces) {
    const placeId = place.id
    if (existingSet.has(placeId)) {
      continue
    }

    const businessName = place.displayName!.text
    const address = place.formattedAddress || null
    const website = place.websiteUri || null
    const hasWebsite = Boolean(website && website.trim() !== '')

    const discovery = scoreDiscoverySignals({
      hasWebsite,
      userRatingCount: typeof place.userRatingCount === 'number' ? place.userRatingCount : null,
      rating: typeof place.rating === 'number' ? place.rating : null,
      pageIndex,
    })

    // A place that already scores at/above the send cutoff on discovery signals
    // alone is strong enough that we never want it. Suppress it so later runs
    // don't re-fetch it, and don't store a row we'd only delete later.
    if (discovery.score >= MAX_SEO_SCORE_TO_SEND) {
      await pool.query(
        `INSERT INTO suppressed_places (place_id) VALUES ($1) ON CONFLICT (place_id) DO NOTHING`,
        [placeId]
      )
      continue
    }

    const leadStatus = hasWebsite ? 'new' : 'no_website'

    const insertResult = await pool.query(
      `INSERT INTO leads (niche_id, business_name, address, website, place_id, status, seo_score, seo_flags)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (place_id) DO NOTHING`,
      [nicheId, businessName, address, website, placeId, leadStatus, discovery.score, discovery.flags.join(',') || null]
    )

    if (insertResult.rowCount && insertResult.rowCount > 0) {
      newLeadsCount++
    }
  }

  return { inserted: newLeadsCount, status, ...(resultError && { error: resultError }) }
}
