import { pool } from './db'
import { callDeepSeekJson } from './ai'

interface NicheRow {
  label: string
  city: string
  status: string
}

interface NicheSuggestion {
  label: string
  city: string
  reasoning: string
}

function nicheKey(label: string, city: string): string {
  return `${label.trim().toLowerCase()}|${city.trim().toLowerCase()}`
}

export async function expandNiches(): Promise<number> {
  const result = await pool.query('SELECT label, city, status FROM niches')
  const allNiches: NicheRow[] = result.rows

  const activeNiches = allNiches.filter((n) => n.status === 'active')
  if (activeNiches.length > 0) {
    return 0
  }

  const triedList = allNiches
    .map((n) => `- ${n.label} in ${n.city} (${n.status})`)
    .join('\n')

  // Defense in depth: never insert a combo that already exists (case-insensitive),
  // even if the model re-suggests one from the "already tried" list.
  const existingKeys = new Set(allNiches.map((n) => nicheKey(n.label, n.city)))

  const systemPrompt = `You are an AI assistant helping a freelance web developer find new local business niches and cities for cold email outreach.
Your task is to suggest 3 to 5 NEW local-business niche and city combinations suitable for cold outreach offering website development and SEO optimization services.
Do NOT suggest any niches or cities that have already been tried or are currently active.
Here is the list of niches already tried or active:
${triedList}

Return STRICT JSON as an array of objects with this exact structure, with no other text, explanation, or markdown fences:
[
  {
    "label": "string",
    "city": "string",
    "reasoning": "string"
  }
]
`

  const suggestions = await callDeepSeekJson<NicheSuggestion[]>(
    systemPrompt,
    'Suggest new niche and city combinations.',
    (value) => {
      if (!Array.isArray(value)) return null
      const items: NicheSuggestion[] = []
      for (const item of value) {
        if (typeof item !== 'object' || item === null) continue
        const obj = item as Record<string, unknown>
        if (typeof obj.label !== 'string' || typeof obj.city !== 'string' || typeof obj.reasoning !== 'string') {
          continue
        }
        const label = obj.label.trim()
        const city = obj.city.trim()
        if (label === '' || city === '') continue
        items.push({ label, city, reasoning: obj.reasoning.trim() })
      }
      return items.length > 0 ? items : null
    }
  )

  if (suggestions === null) {
    return 0
  }

  let insertedCount = 0
  const seenKeys = new Set<string>()
  for (const suggestion of suggestions) {
    const key = nicheKey(suggestion.label, suggestion.city)
    if (existingKeys.has(key) || seenKeys.has(key)) {
      continue
    }
    seenKeys.add(key)

    await pool.query(
      `INSERT INTO niches (label, city, status, source, reasoning)
       VALUES ($1, $2, 'active', 'ai_suggested', $3)`,
      [suggestion.label, suggestion.city, suggestion.reasoning]
    )
    insertedCount++
  }

  return insertedCount
}
