import { pool } from './db'
import * as cheerio from 'cheerio'
import { extractEmails, extractEmailsFromHtml } from './scraper'
import { isSuppressedEmail } from './suppression'
import { MAX_EMAIL_SEARCH_RESULTS } from './constants'

const DDG_HTML_URL = 'https://html.duckduckgo.com/html/'
const BING_HTML_URL = 'https://www.bing.com/search'
const SEARCH_TIMEOUT_MS = 10000
const FETCH_TIMEOUT_MS = 10000
const REQUEST_DELAY_MS = 400
const SEARCH_ATTEMPTS = 2
const SEARCH_RETRY_DELAY_MS = 2000
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

interface SearchResults {
  urls: string[]
  snippetEmails: string[]
}

async function ddgSearch(query: string): Promise<SearchResults> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS)

  let res: Response
  try {
    res = await fetch(`${DDG_HTML_URL}?q=${encodeURIComponent(query)}`, {
      signal: controller.signal,
      headers: { 'User-Agent': USER_AGENT },
    })
  } finally {
    clearTimeout(timeoutId)
  }

  // DuckDuckGo answers a rate limit with HTTP 202 (and sometimes 403) plus an
  // "unusual traffic" page. That is NOT "no results": treating it as a clean
  // empty search would delete the lead and permanently suppress its place.
  // Throw instead so the caller retries and/or falls back to another engine.
  if (!res.ok || res.status === 202 || res.status === 403) {
    throw new Error(`DuckDuckGo search failed with status ${res.status}`)
  }

  const html = await res.text()
  if (/unusual traffic|anomaly/i.test(html)) {
    throw new Error('DuckDuckGo served an anomaly/rate-limit page')
  }

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

// Fallback engine: Bing's HTML results. DuckDuckGo frequently blocks
// datacenter IPs (GitHub Actions runners) with 403s, and a 403 means "blocked",
// not "no results" — so when DDG is unreachable we try Bing before giving up so
// the lead stays in the queue instead of being wrongly treated as un-emailable.
async function bingSearch(query: string): Promise<SearchResults> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS)

  let res: Response
  try {
    res = await fetch(`${BING_HTML_URL}?q=${encodeURIComponent(query)}`, {
      signal: controller.signal,
      headers: {
        'User-Agent': USER_AGENT,
        'Accept-Language': 'en-US,en;q=0.9',
      },
    })
  } finally {
    clearTimeout(timeoutId)
  }

  if (!res.ok) {
    throw new Error(`Bing search failed with status ${res.status}`)
  }

  const html = await res.text()
  if (/captcha|unusual traffic/i.test(html) && html.length < 20000) {
    throw new Error('Bing served a captcha/block page')
  }

  const $ = cheerio.load(html)

  const urls: string[] = []
  $('li.b_algo h2 a').each((_, el) => {
    const href = $(el).attr('href')
    if (href && href.startsWith('http')) urls.push(href)
  })

  const snippets: string[] = []
  $('li.b_algo .b_caption p, li.b_algo p').each((_, el) => {
    const text = $(el).text()
    if (text) snippets.push(text)
  })

  return {
    urls: Array.from(new Set(urls)).slice(0, MAX_EMAIL_SEARCH_RESULTS),
    snippetEmails: extractEmails(snippets.join(' ')),
  }
}

async function searchResultUrls(query: string): Promise<SearchResults> {
  // Try DuckDuckGo with a bounded retry: a 202/403/429 is a bot/rate-limit
  // response that can clear within seconds, so retry once before falling back
  // to Bing. Only if every attempt and the fallback fail do we surface an error
  // (which keeps the lead queued rather than deleting it as "no email found").
  let lastDdgError: string | null = null
  for (let attempt = 1; attempt <= SEARCH_ATTEMPTS; attempt++) {
    try {
      return await ddgSearch(query)
    } catch (err) {
      lastDdgError = err instanceof Error ? err.message : String(err)
      if (attempt < SEARCH_ATTEMPTS) await sleep(SEARCH_RETRY_DELAY_MS)
    }
  }

  try {
    return await bingSearch(query)
  } catch (err) {
    const bingError = err instanceof Error ? err.message : String(err)
    throw new Error(`Email search failed: ${lastDdgError}; Bing fallback: ${bingError}`)
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
): Promise<{ sourced: number; deleted: number; failures: string[] }> {
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
  const failures: string[] = []

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
      const message = err instanceof Error ? err.message : String(err)
      console.error(`Email search failed for lead ${lead.id} (${businessName}):`, message)
      // Surface the failure so a DuckDuckGo outage (or rate limit) is visible
      // on the dashboard instead of silently retrying every day.
      failures.push(`Lead ${lead.id} (${businessName}): ${message}`)
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

    const trimmedEmail = email?.trim()
    if (trimmedEmail) {
      await pool.query(
        `UPDATE leads SET email = $1, scraped_content = $2, status = 'scraped' WHERE id = $3`,
        [trimmedEmail, fallbackContent, lead.id]
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

  return { sourced, deleted, failures }
}
