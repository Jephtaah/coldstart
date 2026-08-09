import { pool } from './db'
import * as cheerio from 'cheerio'
import { extractEmails, extractEmailsFromHtml } from './scraper'
import { isSuppressedEmail } from './suppression'
import { MAX_EMAIL_SEARCH_RESULTS } from './constants'

const DDG_HTML_URL = 'https://html.duckduckgo.com/html/'
const SEARCH_TIMEOUT_MS = 10000
const FETCH_TIMEOUT_MS = 10000
const REQUEST_DELAY_MS = 400
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

// Aggregator/directory hosts rarely expose the business's own email publicly
// (Yelp, Facebook, etc. gate it behind their own forms) and their pages often
// contain unrelated placeholder addresses. Skip them when fetching result pages
// so a wrong address never gets harvested.
const DIRECTORY_HOSTS = new Set([
  'yelp.com',
  'facebook.com',
  'instagram.com',
  'linkedin.com',
  'twitter.com',
  'x.com',
  'yellowpages.com',
  'mapquest.com',
  'manta.com',
  'superpages.com',
  'chamberofcommerce.com',
  'bbb.org',
  'angieslist.com',
  'homeadvisor.com',
  'houzz.com',
  'thumbtack.com',
  'nextdoor.com',
  'foursquare.com',
])

function hostname(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return ''
  }
}

interface NoWebsiteLead {
  id: string
  business_name: string
  address: string | null
  place_id: string | null
  city: string
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function fetchHtml(url: string, timeoutMs: number): Promise<string> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'User-Agent': USER_AGENT },
    })
    if (!res.ok) {
      throw new Error(`Failed to fetch ${url}: status ${res.status}`)
    }
    return await res.text()
  } finally {
    clearTimeout(timeoutId)
  }
}

async function searchResultUrls(query: string): Promise<{ urls: string[]; snippetEmails: string[] }> {
  const html = await fetchHtml(`${DDG_HTML_URL}?q=${encodeURIComponent(query)}`, SEARCH_TIMEOUT_MS)
  const $ = cheerio.load(html)

  const urls: string[] = []
  $('a.result__a').each((_, el) => {
    const href = $(el).attr('href')
    if (!href) return
    // DuckDuckGo wraps result links in /l/?uddg=<url> redirects; unwrap them.
    let target = href
    try {
      const parsed = new URL(href.startsWith('//') ? `https:${href}` : href, DDG_HTML_URL)
      const uddg = parsed.searchParams.get('uddg')
      if (uddg) target = uddg
    } catch {
      // fall back to the raw href
    }
    urls.push(target)
  })

  const snippets: string[] = []
  $('.result__snippet').each((_, el) => {
    const text = $(el).text()
    if (text) snippets.push(text)
  })

  return {
    urls: Array.from(new Set(urls)).slice(0, MAX_EMAIL_SEARCH_RESULTS),
    snippetEmails: extractEmails(snippets.join(' ')),
  }
}

async function findEmailForBusiness(businessName: string, city: string): Promise<string | null> {
  const { urls, snippetEmails } = await searchResultUrls(`${businessName} ${city}`)
  if (snippetEmails.length > 0) return snippetEmails[0]

  for (const url of urls) {
    if (DIRECTORY_HOSTS.has(hostname(url))) {
      continue
    }
    try {
      const html = await fetchHtml(url, FETCH_TIMEOUT_MS)
      const emails = extractEmailsFromHtml(html)
      if (emails.length > 0) return emails[0]
    } catch (err) {
      console.error(`Page fetch failed during email search for "${businessName}":`, err)
    }
    await sleep(REQUEST_DELAY_MS)
  }

  return null
}

export async function sourceNoWebsiteEmails(
  max: number,
  isExhausted?: () => boolean
): Promise<{ sourced: number; deleted: number }> {
  const result = await pool.query(
    `SELECT l.id, l.business_name, l.address, l.place_id, n.city
     FROM leads l JOIN niches n ON n.id = l.niche_id
     WHERE l.status = 'no_website' AND l.email IS NULL AND l.scraped_content IS NULL
     ORDER BY l.seo_score ASC NULLS LAST
     LIMIT $1`,
    [max]
  )

  let sourced = 0
  let deleted = 0

  for (const lead of result.rows as NoWebsiteLead[]) {
    if (isExhausted?.()) break

    const businessName = lead.business_name
    const city = lead.city

    let email: string | null = null
    let searchFailed = false
    try {
      email = await findEmailForBusiness(businessName, city)
      // Skip addresses that already bounced/complained so a dead address can't
      // be re-sourced for another lead.
      if (email && (await isSuppressedEmail(email))) {
        email = null
      }
    } catch (err) {
      console.error(`Email search failed for lead ${lead.id} (${businessName}):`, err)
      searchFailed = true
    }

    // A thrown error means the search itself broke (DuckDuckGo unreachable,
    // rate-limited, or a malformed response) — it does NOT mean the business has
    // no findable email. Leave the lead in 'no_website' so a later run retries
    // instead of deleting it and suppressing its place forever.
    if (searchFailed) {
      continue
    }

    const fallbackContent = `Business Name: ${businessName}\nAddress: ${lead.address || 'Unknown Address'}\nCity: ${city}\nWebsite: None`

    if (email && email.trim() !== '') {
      await pool.query(
        `UPDATE leads SET email = $1, scraped_content = $2, status = 'scraped' WHERE id = $3`,
        [email, fallbackContent, lead.id]
      )
      sourced++
    } else {
      // No email findable: don't store useless data. Delete and suppress so
      // discovery never re-adds it.
      if (lead.place_id) {
        await pool.query(
          `INSERT INTO suppressed_places (place_id) VALUES ($1) ON CONFLICT (place_id) DO NOTHING`,
          [lead.place_id]
        )
      }
      await pool.query('DELETE FROM leads WHERE id = $1', [lead.id])
      deleted++
    }

    await sleep(REQUEST_DELAY_MS)
  }

  return { sourced, deleted }
}
