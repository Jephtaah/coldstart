import { pool } from './db'
import * as cheerio from 'cheerio'

const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g

function extractEmails(text: string): string[] {
  const matches = text.match(EMAIL_REGEX)
  if (!matches) return []
  // Filter out common image extensions or bogus matches
  return Array.from(new Set(matches)).filter(
    (email) =>
      !email.endsWith('.png') &&
      !email.endsWith('.jpg') &&
      !email.endsWith('.gif') &&
      !email.endsWith('.svg') &&
      !email.includes('example.com') &&
      !email.includes('sentry.io')
  )
}

async function fetchPageTextAndEmails(url: string): Promise<{ text: string; emails: string[] }> {
  let formattedUrl = url.trim()
  if (!/^https?:\/\//i.test(formattedUrl)) {
    formattedUrl = 'https://' + formattedUrl
  }

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 10000)

  try {
    const res = await fetch(formattedUrl, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    })
    clearTimeout(timeoutId)

    if (!res.ok) {
      throw new Error(`Failed to fetch ${formattedUrl}: status ${res.status}`)
    }

    const html = await res.text()
    const $ = cheerio.load(html)

    // Extract mailto links
    const mailtoEmails: string[] = []
    $('a[href^="mailto:"]').each((_, el) => {
      const href = $(el).attr('href')
      if (href) {
        const rawPart = href.replace(/^mailto:/i, '').split('?')[0].trim()
        if (rawPart) {
          let emailPart = rawPart
          try {
            emailPart = decodeURIComponent(rawPart).trim()
          } catch {
            // leave the raw value if it is not valid URL-encoding
          }
          mailtoEmails.push(emailPart)
        }
      }
    })

    // Remove unwanted elements
    $('script, style, nav, footer, header, noscript').remove()

    const bodyText = $('body').text().replace(/\s+/g, ' ').trim()
    const textEmails = extractEmails(html)

    const allEmails = Array.from(new Set([...mailtoEmails, ...textEmails]))

    return {
      text: bodyText.slice(0, 3000),
      emails: allEmails,
    }
  } catch (error) {
    clearTimeout(timeoutId)
    throw error
  }
}

export async function scrapeWebsite(leadId: string): Promise<boolean> {
  const result = await pool.query(
    'SELECT website, email, business_name, address, place_id FROM leads WHERE id = $1',
    [leadId]
  )

  if (result.rows.length === 0) {
    return false
  }

  const lead = result.rows[0]
  const website = lead.website
  const existingEmail = lead.email
  const businessName = lead.business_name || 'Unknown Business'
  const address = lead.address || 'Unknown Address'

  async function discardLead() {
    if (lead.place_id) {
      await pool.query(
        `INSERT INTO suppressed_places (place_id) VALUES ($1) ON CONFLICT (place_id) DO NOTHING`,
        [lead.place_id]
      )
    }
    await pool.query('DELETE FROM leads WHERE id = $1', [leadId])
  }

  if (!website || website.trim() === '') {
    await discardLead()
    return false
  }

  try {
    const { text, emails } = await fetchPageTextAndEmails(website)
    let bestEmail = existingEmail
    if (!bestEmail && emails.length > 0) {
      bestEmail = emails[0]
    }

    if (!bestEmail || bestEmail.trim() === '') {
      await discardLead()
      return false
    }

    const scrapedContent = text || `Business Name: ${businessName}\nAddress: ${address}\nWebsite: ${website}`

    await pool.query(
      `UPDATE leads SET scraped_content = $1, email = $2, status = 'scraped' WHERE id = $3`,
      [scrapedContent, bestEmail, leadId]
    )
    return true
  } catch {
    if (existingEmail) {
      const fallbackContent = `Business Name: ${businessName}\nAddress: ${address}\nWebsite: ${website} (Scrape failed, email retained)`
      await pool.query(
        `UPDATE leads SET scraped_content = $1, status = 'scraped' WHERE id = $2`,
        [fallbackContent, leadId]
      )
      return true
    }
    await discardLead()
    return false
  }
}
