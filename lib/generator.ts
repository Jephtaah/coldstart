import { pool } from './db'
import { isSuppressedEmail } from './suppression'
import { callDeepSeekJson, parseEmailResponse } from './ai'

export async function generateEmail(leadId: string): Promise<boolean> {
  const result = await pool.query(
    'SELECT business_name, website, email, scraped_content, place_id FROM leads WHERE id = $1',
    [leadId]
  )

  if (result.rows.length === 0) {
    return false
  }

  const lead = result.rows[0]
  if (!lead.email || lead.email.trim() === '') {
    if (lead.place_id) {
      await pool.query(
        `INSERT INTO suppressed_places (place_id) VALUES ($1) ON CONFLICT (place_id) DO NOTHING`,
        [lead.place_id]
      )
    }
    await pool.query('DELETE FROM leads WHERE id = $1', [leadId])
    return false
  }

  // Don't spend generation tokens on an address that has bounced or complained.
  // The email could have been suppressed after this lead was scraped (e.g. a
  // different lead with the same address bounced), so re-check before the AI call.
  if (await isSuppressedEmail(lead.email)) {
    if (lead.place_id) {
      await pool.query(
        `INSERT INTO suppressed_places (place_id) VALUES ($1) ON CONFLICT (place_id) DO NOTHING`,
        [lead.place_id]
      )
    }
    await pool.query('DELETE FROM leads WHERE id = $1', [leadId])
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

  const emailData = await callDeepSeekJson(
    systemPrompt,
    `Generate the email for ${businessName}.`,
    parseEmailResponse
  )

  // callDeepSeekJson throws AiUnavailableError when the provider fails after
  // its retries. We deliberately do NOT mark the lead failed here: a transient
  // AI outage is not the lead's fault, and permanently failing a valid lead
  // over it loses the outreach target. The caller leaves it queued ('scraped')
  // so a later run retries generation, and records the failure in the errors
  // table.

  await pool.query(
    `UPDATE leads SET generated_subject = $1, generated_body = $2, status = 'generated' WHERE id = $3`,
    [emailData.subject, emailData.body, leadId]
  )

  return true
}
