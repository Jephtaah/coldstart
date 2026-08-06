import { pool } from './db'

interface NicheRow {
  label: string
  city: string
  status: string
}

export async function expandNiches(): Promise<number> {
  const apiKey = process.env.DEEPSEEK_API_KEY || process.env.AI_API_KEY
  if (!apiKey) {
    throw new Error('DEEPSEEK_API_KEY or AI_API_KEY is not set in environment variables.')
  }

  const result = await pool.query('SELECT label, city, status FROM niches')
  const allNiches: NicheRow[] = result.rows

  const activeNiches = allNiches.filter((n) => n.status === 'active')
  if (activeNiches.length > 0) {
    return 0
  }

  const triedList = allNiches
    .map((n) => `- ${n.label} in ${n.city} (${n.status})`)
    .join('\n')

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

  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 20000)
    try {
      const res = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: 'deepseek-v4-flash',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: 'Suggest new niche and city combinations.' },
          ],
          temperature: 0.7,
        }),
        signal: controller.signal,
      })
      clearTimeout(timeoutId)

      if (!res.ok) {
        throw new Error(`DeepSeek API error: ${res.status} ${await res.text()}`)
      }

      const data = await res.json()
      let content = data.choices?.[0]?.message?.content
      if (!content) throw new Error('Empty response from DeepSeek API')

      content = content.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/, '').trim()

      const parsed = JSON.parse(content)
      if (!Array.isArray(parsed)) {
        throw new Error('Parsed JSON is not an array')
      }

      let insertedCount = 0
      for (const item of parsed) {
        if (
          typeof item.label === 'string' &&
          typeof item.city === 'string' &&
          typeof item.reasoning === 'string' &&
          item.label.trim() !== '' &&
          item.city.trim() !== ''
        ) {
          await pool.query(
            `INSERT INTO niches (label, city, status, source, reasoning)
             VALUES ($1, $2, 'active', 'ai_suggested', $3)`,
            [item.label.trim(), item.city.trim(), item.reasoning.trim()]
          )
          insertedCount++
        }
      }

      if (insertedCount > 0) {
        return insertedCount
      }
    } catch (err) {
      clearTimeout(timeoutId)
      console.error('Error in expandNiches:', err)
    }
  }

  return 0
}
