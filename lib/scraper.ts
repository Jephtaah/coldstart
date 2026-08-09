import { pool } from './db'
import * as cheerio from 'cheerio'
import { scoreSiteSignals, mergeSeoScores, DEFAULT_SEO_SCORE, type SiteSignals } from './seo'
import { isSuppressedEmail } from './suppression'
import { SCRAPE_TIMEOUT_MS } from './constants'

const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g

export function extractEmails(text: string): string[] {
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

export function extractEmailsFromHtml(html: string): string[] {
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

  return Array.from(new Set([...mailtoEmails, ...extractEmails(html)]))
}

function emailDomain(email: string): string {
  const at = email.lastIndexOf('@')
  return at === -1 ? '' : email.slice(at + 1).toLowerCase()
}

function siteDomain(siteUrl: string): string {
  const withScheme = /^https?:\/\//i.test(siteUrl) ? siteUrl : `https://${siteUrl}`
  try {
    return new URL(withScheme).hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return ''
  }
}

// Pages often embed addresses that aren't the business's own (agency credits,
// partner listings, embedded-tool support inboxes). Prefer an email on the
// business's own domain, falling back to the first match otherwise.
function pickPreferredEmail(emails: string[], siteUrl: string): string {
  const domain = siteDomain(siteUrl)
  if (domain) {
    const match = emails.find((email) => {
      const d = emailDomain(email)
      return d === domain || d.endsWith(`.${domain}`)
    })
    if (match) return match
  }
  return emails[0]
}

async function fetchPageTextAndEmails(
  url: string
): Promise<{ text: string; emails: string[]; siteSignals: SiteSignals }> {
  let formattedUrl = url.trim()
  if (!/^https?:\/\//i.test(formattedUrl)) {
    formattedUrl = 'https://' + formattedUrl
  }

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), SCRAPE_TIMEOUT_MS)

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

    // Remove unwanted elements
    $('script, style, nav, footer, header, noscript').remove()

    const bodyText = $('body').text().replace(/\s+/g, ' ').trim()
    const allEmails = extractEmailsFromHtml(html)

    const siteSignals: SiteSignals = {
      title: $('title').first().text().trim(),
      metaDescription: $('meta[name="description"]').first().attr('content')?.trim() || '',
      hasViewport: $('meta[name="viewport"]').length > 0,
      h1Count: $('h1').length,
      bodyWordCount: bodyText ? bodyText.split(/\s+/).length : 0,
    }

    return {
      text: bodyText.slice(0, 3000),
      emails: allEmails,
      siteSignals,
    }
  } catch (error) {
    clearTimeout(timeoutId)
    throw error
  }
}

export async function scrapeWebsite(leadId: string): Promise<boolean> {
  const result = await pool.query(
    'SELECT website, email, business_name, address, place_id, seo_score, seo_flags FROM leads WHERE id = $1',
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
  const existingSeoScore = lead.seo_score == null ? DEFAULT_SEO_SCORE : Number(lead.seo_score)
  const existingSeoFlags: string[] =
    typeof lead.seo_flags === 'string' && lead.seo_flags.trim() !== ''
      ? lead.seo_flags.split(',')
      : []

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
    // No website: this lead belongs to the no-website segment. It needs
    // search-based email sourcing (lib/emailfinder.ts), so keep the row and
    // route it back to that pool instead of discarding it.
    await pool.query('UPDATE leads SET status = $1 WHERE id = $2', ['no_website', leadId])
    return false
  }

  try {
    const { text, emails, siteSignals } = await fetchPageTextAndEmails(website)
    let bestEmail = existingEmail
    if (!bestEmail && emails.length > 0) {
      bestEmail = pickPreferredEmail(emails, website)
    }

    if (!bestEmail || bestEmail.trim() === '') {
      await discardLead()
      return false
    }

    // Never store an address that already bounced/complained.
    if (await isSuppressedEmail(bestEmail)) {
      await discardLead()
      return false
    }

    const scrapedContent = text || `Business Name: ${businessName}\nAddress: ${address}\nWebsite: ${website}`

    const siteScore = scoreSiteSignals(siteSignals)
    const mergedScore = mergeSeoScores(existingSeoScore, siteScore.score)
    const combinedFlags = Array.from(
      new Set([...existingSeoFlags, ...siteScore.flags])
    ).join(',')

    await pool.query(
      `UPDATE leads SET scraped_content = $1, email = $2, status = 'scraped', seo_score = $3, seo_flags = $4 WHERE id = $5`,
      [scrapedContent, bestEmail, mergedScore, combinedFlags, leadId]
    )
    return true
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`Scrape failed for lead ${leadId} (${website}):`, message)
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
