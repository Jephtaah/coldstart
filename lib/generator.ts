import { pool } from './db'

export async function generateEmail(leadId: string): Promise<boolean> {
  const apiKey = process.env.DEEPSEEK_API_KEY || process.env.AI_API_KEY
  if (!apiKey) {
    throw new Error('DEEPSEEK_API_KEY or AI_API_KEY is not set in environment variables.')
  }

  const result = await pool.query(
    'SELECT business_name, website, email, scraped_content FROM leads WHERE id = $1',
    [leadId]
  )

  if (result.rows.length === 0) {
    return false
  }

  const lead = result.rows[0]
  if (!lead.email || lead.email.trim() === '') {
    await pool.query('UPDATE leads SET status = $1 WHERE id = $2', ['failed', leadId])
    return false
  }

  const hasWebsite = Boolean(lead.website && lead.website.trim() !== '')
  const businessName = lead.business_name
  const scrapedContent = lead.scraped_content || 'No specific content available.'

  const systemPrompt = `You are an independent freelance web developer reaching out to local business owners. Write a short cold email.
Strict Rules:
1. NO em dashes anywhere in the output.
2. NO corporate filler phrases ("I hope this finds you well", "reaching out", "circle back", "hope you're doing well", etc.).
3. NO parallel-triplet sentence structures ("fast, reliable, and affordable").
4. NO pitch in the first sentence. Ask a question or make an observation that naturally bridges toward what you do.
5. 3-5 sentences total.
6. Casual, human tone. Reads like a real person wrote it in two minutes, not a marketing template.
7. Return STRICT JSON only in this exact format, with no other text or explanation:
{
  "subject": "string",
  "body": "string"
}

Pitch angle context:
${
  hasWebsite
    ? `- The business has a website. Open with ONE specific, genuine detail pulled from their scraped content below. Then pitch site modifications/redesign and SEO optimization to help them rank higher on Google Search and Maps.`
    : `- The business has NO website. Pitch building a clean, modern website from scratch to start capturing local online leads and calls.`
}

Business Name: ${businessName}
Scraped Content / Context:
${scrapedContent}
`

  async function callAI(): Promise<{ subject: string; body: string } | null> {
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
            model: 'deepseek-chat',
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: `Generate the email for ${businessName}.` },
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

        // Strip markdown code fences if present
        content = content.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/, '').trim()

        const parsed = JSON.parse(content)
        if (typeof parsed.subject === 'string' && typeof parsed.body === 'string') {
          return { subject: parsed.subject, body: parsed.body }
        }
      } catch {
        clearTimeout(timeoutId)
        // Retry on parse failure or network error
      }
    }
    return null
  }

  const emailData = await callAI()

  if (!emailData) {
    await pool.query('UPDATE leads SET status = $1 WHERE id = $2', ['failed', leadId])
    return false
  }

  await pool.query(
    `UPDATE leads SET generated_subject = $1, generated_body = $2, status = 'generated' WHERE id = $3`,
    [emailData.subject, emailData.body, leadId]
  )

  return true
}
