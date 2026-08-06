import { pool } from './db'

interface GooglePlace {
  id: string
  displayName?: {
    text: string
  }
  formattedAddress?: string
  websiteUri?: string
}

interface PlacesSearchResponse {
  places?: GooglePlace[]
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

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 10000)

  let response: Response
  try {
    response = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.websiteUri',
      },
      body: JSON.stringify({
        textQuery: `${nicheLabel} in ${city}`,
      }),
      signal: controller.signal,
    })
  } catch (err: unknown) {
    throw new Error(`Google Places API network error or timeout: ${err instanceof Error ? err.message : String(err)}`)
  } finally {
    clearTimeout(timeoutId)
  }

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(
      `Google Places API request failed with status ${response.status}: ${errorText}`
    )
  }

  const data = (await response.json()) as PlacesSearchResponse
  const places = data.places || []

  const validPlaces = places.filter(
    (p) => p.id && p.displayName?.text && p.websiteUri && p.websiteUri.trim() !== ''
  )
  if (validPlaces.length === 0) {
    return 0
  }

  const placeIds = validPlaces.map((p) => p.id)

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

  for (const place of validPlaces) {
    const placeId = place.id
    if (existingSet.has(placeId)) {
      continue
    }

    const businessName = place.displayName!.text
    const address = place.formattedAddress || null
    const website = place.websiteUri || null

    const insertResult = await pool.query(
      `INSERT INTO leads (niche_id, business_name, address, website, place_id, status)
       VALUES ($1, $2, $3, $4, $5, 'new')
       ON CONFLICT (place_id) DO NOTHING`,
      [nicheId, businessName, address, website, placeId]
    )

    if (insertResult.rowCount && insertResult.rowCount > 0) {
      newLeadsCount++
    }
  }

  return newLeadsCount
}
