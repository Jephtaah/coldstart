# Cold Outreach Automation — PRD

## 1. Problem

Jephtah runs cold email outreach for his dev agency (garage door repair, chiropractic, and other local-business niches) entirely by hand: finding businesses, checking their site, writing a personalized email, sending it. This doesn't scale and eats time that should go into client work.

## 2. Goal

A single-user, always-running pipeline that:
1. Finds businesses in a target niche/city via Google Places, pulling only from the deeper result pages (page 3+), which skew toward businesses that rank low on Google — the ones that actually need SEO help
2. Scores every business on SEO weakness (weak Google presence + weak on-page signals) so outreach is spent on the worst-performing websites first
3. Finds contact emails by scraping their website
4. Generates a personalized cold email tailored to their state: site modifications/redesign & SEO to rank higher on Google Search & Maps
5. Sends it automatically, within safe daily limits
6. Sends one automatic follow-up after 7 days if nothing else happened
7. Logs everything, and expands into new niches on its own once a niche is exhausted

No manual review step in the loop. Jephtah checks in on a dashboard when he wants to, not because the app needs him to.

## 3. Non-goals (v1)

- No multi-user auth, login forms, or passcode UI (single operator)
- No reply detection or inbox parsing (replies go to his normal inbox, untouched)
- No opt-out/unsubscribe handling (deliberately left out — see decisions below)
- No CRM-style deal tracking / pipeline stages
- No A/B testing or advanced analytics — just send/open logs

## 4. Core decisions

| Decision | Answer |
|---|---|
| Access control | No auth, login forms, passcodes, or access keys. Any request to the dashboard or endpoints is allowed. |
| Send mode | Fully autonomous send, no per-email approval. Guardrails instead of a human checkpoint. |
| Niche targeting | Preset catalog of US cities & industries with multi-select controls (minimum 3 of each selected, defaulting to 3 default industries × 3 default cities = 9 initial active search pools). Auto-expansion proposes and adds new niche/city combinations once existing targets are exhausted. |
| Email sending | Resend, free tier (3,000/mo, 100/day), against a newly purchased domain (~$10-12/yr). Gmail/no-domain sending rejected — sandbox restrictions and personal-account ban risk. |
| Open tracking | Included — Resend's pixel + webhook. |
| Reply tracking | Not built. Replies just show up in his normal inbox. |
| Follow-up | One automatic follow-up email, 7 days after the first, sent regardless of whether they replied (no reply detection to check against). |
| Opt-out language | Deliberately omitted. Note: CAN-SPAM technically covers one-time commercial outreach too (real sender identity, physical address, some opt-out path) — not just newsletters. Not legal advice, and enforcement risk for this scale is low, but it's a conscious tradeoff being made, not an oversight. |
| Blocklist | Not built — no opt-out mechanism means nothing to check against. Dedup (never email the same business twice) is kept regardless, since that's just avoiding wasted/duplicate sends, unrelated to compliance. |
| AI provider | DeepSeek (OpenAI-compatible API) for scrape-summarization and email generation, behind one swappable function so another provider can be dropped in later. |
| Email sourcing | Businesses are required to have a website (v1 targets only businesses with a site that ranks weak on SEO). Emails are found by scraping the site (homepage, `/contact`, `/about`, footer) using regex + `mailto:` link extraction. Leads with no discoverable email are discarded before generation. |
| Offer positioning | Every lead already has an existing website, so the pitch is site modifications/redesign & SEO optimization to rank higher on Google Search & Maps, opened with one specific detail pulled from the scraped content. |
| Target selection | Businesses with no website are excluded in v1 — Google Places does not expose email addresses, so that segment can't be reached by email. Instead, the pipeline targets businesses with a website that ranks weak: scored at discovery (review count, rating, result-page depth) and again on the live site (missing title / meta description / mobile viewport / H1, thin content). The daily cap is spent on the weakest-SEO sites first. |
| Business discovery | Google Places API (Text Search — New). Paginates past the first 2 result pages and collects only pages 3+ (~20 results each), because prominence-ranked results mean page 1 holds the businesses that don't need SEO help. Has a real per-call cost, offset by Google's monthly free credit at this volume — the one line item worth watching in Google Cloud billing. |
| Automation trigger | A scheduled job (GitHub Actions, free) calls one URL on your app daily. No server needs to run 24/7. |

## 5. Guardrails (v1)

- **Daily send cap**: configurable (default 90/day), hard-capped under Resend's 100/day free ceiling. Once the cap is reached, discovery and the rest of the pipeline stop and wait for the next day.
- **Dedup**: never contact the same business twice (checked by domain + place_id before every send).
- **Follow-up cap**: exactly one follow-up per lead, only once, only 7+ days after the first send.
- **Pause switch**: one flag in settings that halts all sending immediately.
- **Targeting guardrail**: minimum 3 active industries and 3 active US cities selected at any point (defaulting to Garage Door Repair, Chiropractor, Roofing Contractor × Dallas TX, Austin TX, Miami FL, giving 9 active search pools).
- **SEO-first targeting**: every lead is scored 0–100 on SEO weakness (lower = weaker). Scrape, generation, and send stages all process the weakest first, so the daily cap is spent on the businesses that need the service most. Leads scoring 65 or above are hard-skipped (marked `skipped`) and never generated or emailed. Businesses without a website are intentionally out of scope for v1.
- **Style guardrail**: the AI prompt enforces Jephtah's known preferences (no em dashes, no corporate filler, no template-triplet phrasing, one honest specific detail as the opener, no generic "I noticed your website..." lines) and pitches site modifications/redesign & SEO optimization (all v1 leads have an existing website).

## 6. Architecture (high level)

- **Frontend/dashboard**: Next.js (App Router, TypeScript, Tailwind) — a simple internal tool.
- **Database**: Neon (serverless Postgres) — 4 tables: `niches`, `leads`, `settings`, `suppressed_places`. Plain `pg` for queries, no ORM, no vendor-specific client — Neon is being used purely as hosted Postgres.
- **Scraping, email extraction & SEO analysis**: server-side fetch + text extraction from the business's own website (homepage + `/contact` + `/about` if linked), plus regex-based email extraction and `mailto:` link parsing. The same pass also analyzes on-page SEO signals (title, meta description, mobile viewport, H1, content depth) and writes a weakness score + flags to the lead.
- **AI generation**: DeepSeek API call, using a prompt that opens with one specific detail from the scraped content and pitches site modifications/redesign & SEO optimization, behind one swappable function.
- **Sending**: Resend API, domain verified, tracking enabled.
- **Automation trigger**: GitHub Actions cron calling an endpoint on a schedule.
- **Webhook**: one endpoint to receive Resend's open-tracking events and write them to the DB.

## 7. Data model

- **`niches`** — id, label, city, status (`active` / `exhausted`), source (`seed` / `ai_suggested`), reasoning (nullable, filled when AI-suggested), created_at
- **`leads`** — id, niche_id, business_name, address, website, email, place_id, status (`new` / `scraped` / `generated` / `sent` / `followed_up` / `skipped` / `failed`), seo_score (0 = weakest SEO, top outreach priority; 100 = strongest), seo_flags (comma-separated weaknesses: no_title, no_meta_description, no_viewport, no_h1, thin_content, low_review_count, deep_result_page_N), scraped_content, generated_subject, generated_body, initial_sent_at, initial_opened_at, initial_resend_id, followup_subject, followup_body, followup_sent_at, followup_opened_at, followup_resend_id, bounced_at, created_at
- **`settings`** — single row: daily_cap, paused (bool), last_run_at
- **`suppressed_places`** — place_id of businesses dropped by the pipeline (no website, unreachable, or no discoverable email), so they're never re-inserted by a later discovery run
- **`suppressed_emails`** — email of addresses that bounced or complained, so they're never re-sent or re-sourced by a later run

No separate email-log or opt-out tables — everything about a lead's email history lives on the lead row itself, since each lead gets at most two emails.

## 8. Open items to revisit later (not blocking v1)

- Whether to eventually add reply detection if manually checking the inbox becomes annoying
- Whether to move off Resend free tier if volume grows past 100/day
- Whether niche auto-expansion needs a sanity check after a few weeks of real suggestions
- Whether to reconsider the opt-out omission if a business ever asks to stop and there's no clean way to log it beyond memory
- Whether to bring businesses without a website back into scope later (e.g., sourcing emails via a SERP/directory search, or a call-based outreach flow) once v1 proves out

See the separate **Milestones & Build Guide** document for the actual step-by-step implementation plan.

## 9. Post-v1 update — SEO scoring, no-website segment, lean database & dashboard pagination

This section documents the changes shipped after the v1 build. Where it contradicts a v1 decision above, this section supersedes it.

### 9.1 Better SEO scoring

Scoring flipped from a score-up bucket model to a weakness-penalty model:

```
score = 100 − pagePenalty − reviewPenalty − ratingPenalty − noWebsitePenalty
```

- **Page depth (dominant signal):** page 1 → 0 · page 2 → 15 · page 3 → 40 · page 4 → 55 · page 5+ → 65
- **Review count:** none → 25 · 0 → 30 · 1–5 → 20 · 6–20 → 12 · 21–50 → 6 · 51–150 → 2 · 150+ → 0
- **Rating:** none / <3.5 → 15 · <4.2 → 8 · <4.7 → 3 · 4.7+ → 0
- **No website:** +35

Site scoring and the 60/40 site/discovery merge are unchanged; the send cutoff stays at 65. Net effect: page-3 businesses now land ~20–55 (Weak/Fair) instead of ~70–85 (Solid), so the daily cap is spent on the businesses that need help most.

### 9.2 No-website segment

- Discovery no longer excludes businesses without a website. They are stored as leads with `status = 'no_website'`, the no-website penalty, and a `no_website` SEO flag.
- A new search-based email source (`lib/emailfinder.ts`) queries DuckDuckGo HTML for `"{business_name} {city}"`, fetches the top 4 result pages, and extracts emails with the same regex + `mailto:` logic used by the scraper.
- Leads that find an email move to `scraped` and flow into generation with the existing "build a website" pitch. Leads with no findable email are deleted.

### 9.3 Lean database — delete useless data

- Leads whose merged SEO score is at/above the cutoff (65) are **deleted** (previously stored as `skipped`) and their `place_id` recorded in `suppressed_places` so discovery never re-adds them.
- Discovery suppresses any place that scores at/above 65 on discovery signals alone before inserting it.
- Leads with no discoverable email (whether they have a website or not) are deleted and suppressed.
- `failed` leads (generation/send failures) are intentionally kept for inspection.

### 9.4 Dashboard

- Leads and Niches tables are paginated (10/25/50 rows per page) with prev/next and numbered pages, plus a "Showing X–Y of Z" summary.
- A `no_website` status tab was added; the `skipped` tab was removed (high-SEO leads are now deleted rather than skipped).

### 9.5 Bounce / complaint handling & email suppression

- The Resend webhook now handles `email.bounced` and `email.complained` in addition to `email.opened`. The affected lead is marked failed (with `bounced_at`) so it leaves the send/follow-up queues, and the address is written to a new `suppressed_emails` table.
- Webhook requests are HMAC-verified against the signing secret (`RESEND_WEBHOOK_SECRET`, `whsec_…`) using the Standard Webhooks algorithm; unauthenticated requests are rejected with 401. Until the env var is set, verification logs a warning and stays off.
- `suppressed_emails` (email, reason `bounce`/`complaint`, created_at) is checked by the sender, follow-up, website scraper, and no-website email sourcing so a dead address can never enter the pipeline again — even via re-discovery. Temporary (`Temporary`) bounces are deliberately not suppressed; those surface as `email.delivery_delayed` events.
- The daily pipeline run includes a send-health monitor: 24h bounce/complaint counts that cross thresholds (`BOUNCE_ALERT_THRESHOLD` = 5, `COMPLAINT_ALERT_THRESHOLD` = 1, both in `lib/constants.ts`) trip the failure alert email before a young domain's reputation degrades unseen.
- `leads` gains a nullable `bounced_at` column; `failed` is reused as the on-lead status so the dashboard needs no new filter tab. Run `docs/sql/add-bounce-suppression.sql` (idempotent) to apply the schema changes.

### 9.6 Discovery constraint & next steps

- Google Places caps every query at 60 results (3 pages of 20); pages 4+ do not exist. The pipeline already collects the deepest available page, so "starting from page 5" is not possible through this API.
- The chosen strategy to surface weaker businesses is **query refinement** — splitting cities into neighborhoods/zip codes and adding qualifiers so less-prominent businesses fall within the 60-result window. This is a future item, not yet built.
