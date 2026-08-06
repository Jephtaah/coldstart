import { pool } from './db'
import { Resend } from 'resend'
import { MAX_SEO_SCORE_TO_SEND, MAX_INITIAL_SENDS_PER_DAY } from './constants'

export async function sendBatch(): Promise<number> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    throw new Error('RESEND_API_KEY is not set in environment variables.')
  }

  const senderDomain = process.env.SENDER_DOMAIN || 'example.com'
  const fromEmail = `outreach@${senderDomain}`

  const resend = new Resend(apiKey)

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

  // 2. Count today's sent initial emails (UTC date)
  const countResult = await pool.query(
    `SELECT COUNT(*) FROM leads WHERE initial_sent_at >= CURRENT_DATE`
  )
  const sentTodayCount = parseInt(countResult.rows[0].count, 10) || 0
  // Initial sends are capped by the daily capacity setting and never exceed
  // the hard ceiling. Follow-ups have their own separate daily budget.
  const remaining = Math.min(
    dailyCap - sentTodayCount,
    MAX_INITIAL_SENDS_PER_DAY - sentTodayCount
  )

  if (remaining <= 0) {
    return 0
  }

  // 3. Fetch up to 'remaining' leads with status = 'generated', weakest SEO first,
  //    excluding anything at/above the SEO cutoff (defense in depth).
  const leadsResult = await pool.query(
    `SELECT id, email, generated_subject, generated_body FROM leads
     WHERE status = 'generated' AND (seo_score IS NULL OR seo_score < $2)
     ORDER BY seo_score ASC NULLS LAST LIMIT $1`,
    [remaining, MAX_SEO_SCORE_TO_SEND]
  )

  const leads = leadsResult.rows
  if (leads.length === 0) {
    return 0
  }

  let successfullySent = 0

  for (const lead of leads) {
    if (!lead.email || !lead.generated_subject || !lead.generated_body) {
      await pool.query('UPDATE leads SET status = $1 WHERE id = $2', ['failed', lead.id])
      continue
    }

    try {
      const emailPromise = resend.emails.send({
        from: fromEmail,
        to: lead.email,
        subject: lead.generated_subject,
        text: lead.generated_body,
        replyTo: process.env.REPLY_TO_EMAIL,
      })

      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Resend API timeout')), 10000)
      )

      const emailResponse = (await Promise.race([emailPromise, timeoutPromise])) as Awaited<
        ReturnType<typeof resend.emails.send>
      >

      if (emailResponse.error || !emailResponse.data?.id) {
        console.error(
          `Resend rejected email for lead ${lead.id} (${lead.email}): ${
            emailResponse.error?.message || 'no email id returned'
          }`
        )
        await pool.query('UPDATE leads SET status = $1 WHERE id = $2', ['failed', lead.id])
        continue
      }

      const resendId = emailResponse.data.id

      await pool.query(
        `UPDATE leads SET initial_sent_at = NOW(), initial_resend_id = $1, status = 'sent' WHERE id = $2`,
        [resendId, lead.id]
      )

      successfullySent++
    } catch {
      await pool.query('UPDATE leads SET status = $1 WHERE id = $2', ['failed', lead.id])
    }
  }

  return successfullySent
}
