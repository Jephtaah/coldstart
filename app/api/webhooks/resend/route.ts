import { createHmac, timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { pool } from '@/lib/db'
import { suppressEmail } from '@/lib/suppression'

// Standard Webhooks HMAC verification (Resend signs every request with its
// webhook signing secret). The exact algorithm mirrors the `standardwebhooks`
// library Resend's SDK bundles: base64(HMAC-SHA256(base64-decoded secret,
// "<id>.<timestamp>.<rawBody>")) compared against each `v1,<sig>` in the
// signature header, with a 5-minute timestamp tolerance. Both `svix-*` and
// `webhook-*` header names are accepted since Resend's docs and its bundled
// library disagree on the prefix.
const SIGNATURE_TOLERANCE_SECONDS = 5 * 60
const SIGNATURE_HEADER_NAMES = {
  id: ['svix-id', 'webhook-id'],
  timestamp: ['svix-timestamp', 'webhook-timestamp'],
  signature: ['svix-signature', 'webhook-signature'],
}

function readHeader(headers: Headers, names: string[]): string | null {
  for (const name of names) {
    const value = headers.get(name)
    if (value) return value
  }
  return null
}

function verifyWebhookSignature(rawBody: string, headers: Headers, secret: string): boolean {
  const id = readHeader(headers, SIGNATURE_HEADER_NAMES.id)
  const timestampHeader = readHeader(headers, SIGNATURE_HEADER_NAMES.timestamp)
  const signatureHeader = readHeader(headers, SIGNATURE_HEADER_NAMES.signature)

  if (!id || !timestampHeader || !signatureHeader) {
    return false
  }

  const timestamp = Number(timestampHeader)
  if (!Number.isFinite(timestamp)) {
    return false
  }

  const nowSeconds = Math.floor(Date.now() / 1000)
  if (Math.abs(nowSeconds - timestamp) > SIGNATURE_TOLERANCE_SECONDS) {
    return false
  }

  const encodedSecret = secret.startsWith('whsec_') ? secret.slice('whsec_'.length) : secret
  const key = Buffer.from(encodedSecret, 'base64')
  const signedContent = `${id}.${timestamp}.${rawBody}`
  const expected = createHmac('sha256', key).update(signedContent).digest('base64')
  const expectedBuffer = Buffer.from(expected)

  for (const versionedSignature of signatureHeader.split(' ')) {
    const [version, signature] = versionedSignature.split(',')
    if (version !== 'v1' || !signature) continue
    const suppliedBuffer = Buffer.from(signature)
    if (
      suppliedBuffer.length === expectedBuffer.length &&
      timingSafeEqual(suppliedBuffer, expectedBuffer)
    ) {
      return true
    }
  }

  return false
}

interface WebhookEventData {
  email_id?: string
  id?: string
  to?: string | string[]
  bounce?: { type?: string }
}

export async function POST(request: Request) {
  const rawBody = await request.text()

  const webhookSecret = process.env.RESEND_WEBHOOK_SECRET
  if (!webhookSecret) {
    console.error('RESEND_WEBHOOK_SECRET is not set; rejecting webhook request.')
    return NextResponse.json(
      { success: false, error: 'server not configured for webhooks' },
      { status: 401 }
    )
  }
  if (!verifyWebhookSignature(rawBody, request.headers, webhookSecret)) {
    console.error('Resend webhook rejected: invalid signature')
    return NextResponse.json({ success: false, error: 'invalid signature' }, { status: 401 })
  }

  let body: { type?: string; data?: WebhookEventData }
  try {
    body = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ success: false, error: 'invalid JSON body' }, { status: 400 })
  }

  const { type, data } = body

  try {
    if (type === 'email.opened' && data) {
      const emailId = data.email_id || data.id

      if (emailId) {
        await pool.query(
          `UPDATE leads SET initial_opened_at = NOW() WHERE initial_resend_id = $1`,
          [emailId]
        )

        await pool.query(
          `UPDATE leads SET followup_opened_at = NOW() WHERE followup_resend_id = $1`,
          [emailId]
        )
      }
    }

    if (type === 'email.bounced' || type === 'email.complained') {
      const emailId = data?.email_id || data?.id
      const reason = type === 'email.bounced' ? 'bounce' : 'complaint'

      // Defensive: only permanent rejections warrant suppression. Resend fires
      // email.bounced for permanent failures and email.delivery_delayed for
      // transient ones, but don't suppress a Temporary bounce if one ever lands.
      if (type === 'email.bounced' && data?.bounce?.type === 'Temporary') {
        return NextResponse.json({ success: true }, { status: 200 })
      }

      const toEmail = Array.isArray(data?.to) ? data.to[0] : data?.to

      // Mark the matching lead so it leaves the send/follow-up queues and is
      // recorded for inspection (failed leads are intentionally kept).
      let leadEmail: string | null = null
      if (emailId) {
        const leadResult = await pool.query(
          `SELECT id, email FROM leads WHERE initial_resend_id = $1 OR followup_resend_id = $1 LIMIT 1`,
          [emailId]
        )
        const lead = leadResult.rows[0]
        if (lead) {
          leadEmail = lead.email
          await pool.query(
            `UPDATE leads SET bounced_at = NOW(), status = 'failed' WHERE id = $1`,
            [lead.id]
          )
        }
      }

      // Suppress the address so sender, follow-up, and email sourcing never
      // touch it again, even if the lead row is later deleted (lean DB).
      await suppressEmail(leadEmail || toEmail, reason)
    }

    return NextResponse.json({ success: true }, { status: 200 })
  } catch (error: unknown) {
    // Do NOT swallow this: a bounce/complaint that fails to persist means the
    // address is never suppressed and gets re-emailed, hurting deliverability.
    // Returning 500 lets Resend retry the event with backoff; the handler is
    // idempotent so a retry is safe.
    console.error('Resend webhook error:', error)
    return NextResponse.json({ success: false, error: 'webhook processing failed' }, { status: 500 })
  }
}
