import { pool } from './db'
import { Resend } from 'resend'

export async function sendFollowUps(): Promise<number> {
  const apiKey = process.env.DEEPSEEK_API_KEY || process.env.AI_API_KEY
  if (!apiKey) {
    throw new Error('DEEPSEEK_API_KEY or AI_API_KEY is not set in environment variables.')
  }

  const resendApiKey = process.env.RESEND_API_KEY
  if (!resendApiKey) {
    throw new Error('RESEND_API_KEY is not set in environment variables.')
  }

  const senderDomain = process.env.SENDER_DOMAIN || 'example.com'
  const fromEmail = `outreach@${senderDomain}`
  const resend = new Resend(resendApiKey)

  // 1. Check settings table
  const settingsResult = await pool.query('SELECT daily_cap, paused FROM settings WHERE id = 1')
  if (settingsResult.rows.length === 0) {
    throw new Error('Settings table row with id = 1 not found.')
  }

  const settings = settingsResult.rows[0]
  if (settings.paused) {
    return 0
  }

  const dailyCap = settings.daily_cap

  // 2. Count today's combined initial + follow-up sends (UTC date)
  const countResult = await pool.query(
    `SELECT COUNT(*) FROM leads WHERE initial_sent_at >= CURRENT_DATE OR followup_sent_at >= CURRENT_DATE`
  )
  const sentTodayCount = parseInt(countResult.rows[0].count, 10) || 0
  const remaining = dailyCap - sentTodayCount

  if (remaining <= 0) {
    return 0
  }

  // 3. Find eligible leads: status = 'sent', initial_sent_at > 7 days ago, followup_sent_at is null
  const leadsResult = await pool.query(
    `SELECT id, business_name, email, generated_subject, generated_body FROM leads 
     WHERE status = 'sent' AND initial_sent_at <= NOW() - INTERVAL '7 days' AND followup_sent_at IS NULL 
     LIMIT $1`,
    [remaining]
  )

  const leads = leadsResult.rows
  if (leads.length === 0) {
    return 0
  }

  let successfullySent = 0

  for (const lead of leads) {
    if (!lead.email || lead.email.trim() === '') {
      await pool.query('UPDATE leads SET status = $1 WHERE id = $2', ['failed', lead.id])
      continue
    }

    const businessName = lead.business_name

    const systemPrompt = `You are an independent freelance web developer writing a quick follow-up email to a local business owner.
Strict Rules:
1. NO em dashes anywhere in the output.
2. NO corporate filler phrases ("I hope this finds you well", "reaching out", "circle back", etc.).
3. NO parallel-triplet sentence structures ("fast, reliable, and affordable").
4. 2-3 sentences total.
5. Referencing that this is a quick follow-up to the earlier note, not repeating the full pitch.
6. Casual, human tone.
7. Return STRICT JSON only in this exact format, with no other text or explanation:
{
  "subject": "string",
  "body": "string"
}

Business Name: ${businessName}
Previous Subject: ${lead.generated_subject || ''}
`

    async function generateFollowUpAI(): Promise<{ subject: string; body: string } | null> {
      for (let attempt = 0; attempt < 2; attempt++) {
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
                { role: 'user', content: `Generate the follow-up email for ${businessName}.` },
              ],
              temperature: 0.7,
            }),
          })

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
          // Retry on parse failure or network error
        }
      }
      return null
    }

    const emailData = await generateFollowUpAI()

    if (!emailData) {
      await pool.query('UPDATE leads SET status = $1 WHERE id = $2', ['failed', lead.id])
      continue
    }

    try {
      const emailResponse = await resend.emails.send({
        from: fromEmail,
        to: lead.email,
        subject: emailData.subject,
        text: emailData.body,
        replyTo: process.env.REPLY_TO_EMAIL,
      })

      const resendId = emailResponse.data?.id || 'unknown_id'

      await pool.query(
        `UPDATE leads SET followup_subject = $1, followup_body = $2, followup_sent_at = NOW(), followup_resend_id = $3, status = 'followed_up' WHERE id = $4`,
        [emailData.subject, emailData.body, resendId, lead.id]
      )

      successfullySent++
    } catch {
      await pool.query('UPDATE leads SET status = $1 WHERE id = $2', ['failed', lead.id])
    }
  }

  return successfullySent
}
