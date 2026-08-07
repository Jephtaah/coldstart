import { pool } from './db'
import { scoreDiscoverySignals } from './seo'
import {
  MAX_PLACES_PAGES_PER_NICHE,
  PLACES_PAGES_TO_SKIP,
  MAX_SEO_SCORE_TO_SEND,
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
  const timeoutId = setTimeout(() => controller.abort(), 10000)

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
      throw new Error(
        `Google Places API request failed with status ${response.status}: ${await response.text()}`
      )
    }

    return (await response.json()) as PlacesSearchResponse
  } catch (err: unknown) {
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
): Promise<number> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY
  if (!apiKey) {
    throw new Error('GOOGLE_PLACES_API_KEY is not set in environment variables.')
  }

  const textQuery = `${nicheLabel} in ${city}`
  const collected: PlaceWithPage[] = []
  let pageToken: string | undefined

  for (let page = 0; page < MAX_PLACES_PAGES_PER_NICHE; page++) {
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
      if (page === 0) throw err
      console.error(`Places pagination stopped at page ${page + 1}:`, err)
      break
    }

    if (page < MAX_PLACES_PAGES_PER_NICHE - 1) {
      await sleep(300)
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
    return 0
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

    const status = hasWebsite ? 'new' : 'no_website'

    const insertResult = await pool.query(
      `INSERT INTO leads (niche_id, business_name, address, website, place_id, status, seo_score, seo_flags)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (place_id) DO NOTHING`,
      [nicheId, businessName, address, website, placeId, status, discovery.score, discovery.flags.join(',') || null]
    )

    if (insertResult.rowCount && insertResult.rowCount > 0) {
      newLeadsCount++
    }
  }

  return newLeadsCount
}
