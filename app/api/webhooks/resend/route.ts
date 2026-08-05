import { NextResponse } from 'next/server'
import { pool } from '@/lib/db'

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { type, data } = body

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

    return NextResponse.json({ success: true }, { status: 200 })
  } catch (error: any) {
    console.error('Resend webhook error:', error)
    return NextResponse.json({ success: true }, { status: 200 })
  }
}
