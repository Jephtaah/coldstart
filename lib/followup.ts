import { pool } from './db'
import { Resend } from 'resend'
import { MAX_FOLLOWUPS_PER_DAY, RESEND_TIMEOUT_MS, FOLLOWUP_DELAY_INTERVAL } from './constants'
import { toHtml, sendDelayMs, sleep } from './emailFormat'
import { callDeepSeekJson, parseEmailResponse, getAiApiKey } from './ai'

export interface SendFollowUpsResult {
  sent: number
  // Human-readable descriptions of every lead whose follow-up could not be
  // sent (AI generation failure or Resend rejection), so callers can surface
  // them in the errors table and the cron run instead of silently losing them.
  rejected: string[]
}

export async function sendFollowUps(
  maxFollowups: number,
  isExhausted?: () => boolean
): Promise<SendFollowUpsResult> {
  const resendApiKey = process.env.RESEND_API_KEY
  if (!resendApiKey) {
    throw new Error('RESEND_API_KEY is not set in environment variables.')
  }

  if (!getAiApiKey()) {
    throw new Error('DEEPSEEK_API_KEY or AI_API_KEY is not set in environment variables.')
  }

  const senderDomain = process.env.SENDER_DOMAIN
  if (!senderDomain) {
    throw new Error('SENDER_DOMAIN is not set in environment variables.')
  }
  const senderName = process.env.SENDER_NAME
  const fromEmail = senderName ? `${senderName} <outreach@${senderDomain}>` : `outreach@${senderDomain}`
  const resend = new Resend(resendApiKey)

  // 1. Check settings table
  const settingsResult = await pool.query('SELECT paused FROM settings WHERE id = 1')
  if (settingsResult.rows.length === 0) {
    throw new Error('Settings table row with id = 1 not found.')
  }

  const settings = settingsResult.rows[0]
  if (settings.paused) {
    return { sent: 0, rejected: [] }
  }

  // 2. Count today's follow-up sends (UTC date). Follow-ups have their own
  //    daily budget, separate from the initial-send capacity cap.
  const countResult = await pool.query(
    `SELECT COUNT(*) FROM leads WHERE followup_sent_at >= CURRENT_DATE`
  )
  const sentTodayCount = parseInt(countResult.rows[0].count, 10) || 0
  const remaining = MAX_FOLLOWUPS_PER_DAY - sentTodayCount

  if (remaining <= 0) {
    return { sent: 0, rejected: [] }
  }

  // 3. Find eligible leads: status = 'sent', initial_sent_at > 7 days ago,
  //    followup_sent_at is null, and the address hasn't bounced/complained.
  //    The daily budget is enforced above; this bound keeps one invocation
  //    safely inside the function timeout so the loop can trickle follow-ups.
  const leadsResult = await pool.query(
    `SELECT id, business_name, email, generated_subject, generated_body, followup_subject, followup_body FROM leads 
     WHERE status = 'sent' AND initial_sent_at <= NOW() - $2::interval AND followup_sent_at IS NULL 
       AND NOT EXISTS (SELECT 1 FROM suppressed_emails se WHERE se.email = lower(leads.email))
     LIMIT $1`,
    [Math.min(maxFollowups, remaining), FOLLOWUP_DELAY_INTERVAL]
  )

  const leads = leadsResult.rows
  if (leads.length === 0) {
    return { sent: 0, rejected: [] }
  }

  let successfullySent = 0
  const rejected: string[] = []

  for (const lead of leads) {
    if (isExhausted?.()) break

    if (!lead.email || lead.email.trim() === '') {
      rejected.push(`Lead ${lead.id}: missing email`)
      await pool.query('UPDATE leads SET status = $1 WHERE id = $2', ['failed', lead.id])
      continue
    }

    const businessName = lead.business_name

    // A crashed earlier attempt may have persisted follow-up content without
    // ever recording the sent timestamp. Reuse it so a deduped resend stores
    // exactly what was delivered. Otherwise generate fresh content and persist
    // it before sending, so a crash mid-send can't lose it either.
    const persistedSubject = lead.followup_subject
    const persistedBody = lead.followup_body
    const hasPersistedContent =
      !!persistedSubject &&
      !!persistedBody &&
      persistedSubject.trim() !== '' &&
      persistedBody.trim() !== ''

    let subject: string
    let body: string

    if (hasPersistedContent) {
      subject = persistedSubject
      body = persistedBody
    } else {
      try {
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

        const emailData = await callDeepSeekJson(
          systemPrompt,
          `Generate the follow-up email for ${businessName}.`,
          parseEmailResponse
        )

        subject = emailData.subject
        body = emailData.body

        // Persist before sending so a crash between Resend accepting the email
        // and the sent-at UPDATE can't lose the exact content that was delivered.
        await pool.query(
          'UPDATE leads SET followup_subject = $1, followup_body = $2 WHERE id = $3',
          [subject, body, lead.id]
        )
      } catch (err) {
        // AI failure (network, rate limit, or config) is not the lead's fault:
        // leave it in 'sent' so a later run retries the follow-up, and surface
        // the failure for the operator instead of failing it silently.
        rejected.push(
          `Lead ${lead.id} (${businessName}): follow-up generation failed: ${
            err instanceof Error ? err.message : String(err)
          }`
        )
        continue
      }
    }

    try {
      await sleep(sendDelayMs())

      const emailPromise = resend.emails.send(
        {
          from: fromEmail,
          to: lead.email,
          subject: subject,
          text: body,
          html: toHtml(body),
          replyTo: process.env.REPLY_TO_EMAIL,
        },
        { idempotencyKey: `followup:${lead.id}` }
      )

      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Resend API timeout')), RESEND_TIMEOUT_MS)
      )

      const emailResponse = (await Promise.race([emailPromise, timeoutPromise])) as Awaited<
        ReturnType<typeof resend.emails.send>
      >

      if (emailResponse.error || !emailResponse.data?.id) {
        rejected.push(
          `Lead ${lead.id} (${lead.email}): ${emailResponse.error?.message || 'no email id returned'}`
        )
        await pool.query('UPDATE leads SET status = $1 WHERE id = $2', ['failed', lead.id])
        continue
      }

      const resendId = emailResponse.data.id

      await pool.query(
        `UPDATE leads SET followup_sent_at = NOW(), followup_resend_id = $1, status = 'followed_up' WHERE id = $2`,
        [resendId, lead.id]
      )

      successfullySent++
    } catch (err) {
      rejected.push(
        `Lead ${lead.id} (${lead.email}): ${err instanceof Error ? err.message : String(err)}`
      )
      await pool.query('UPDATE leads SET status = $1 WHERE id = $2', ['failed', lead.id])
    }
  }

  return { sent: successfullySent, rejected }
}
