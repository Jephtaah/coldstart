# ColdStart

An autonomous cold outreach pipeline for a freelance web developer. It finds local businesses in US cities/industries that rank weak on Google, scores their SEO, finds their email, writes and sends a personalized cold email (with one automatic follow-up), and logs everything in a single-operator dashboard. No manual review step — the pipeline runs itself daily and the operator checks the dashboard when they want to.

## How it works

Each scheduled run executes the full loop:

1. **Discovery** — runs on its own endpoint (`/api/discover`), separate from the rest of the pipeline, so a Google Places outage or quota exhaustion can never block scraping, generation, or sending. Google Places Text Search (New) runs for each active niche (`"<industry> in <city>"`). Results are paginated past the first two prominence-ranked pages so outreach targets the businesses that rank low on Google. New leads are inserted (deduped by `place_id`, with a `suppressed_places` list so dropped businesses are never re-added). Every page fetch is charged against a hard **daily Places budget** (`MAX_PLACES_CALLS_PER_DAY`, default 100, tracked in `settings.places_used_*`): once the budget is spent, discovery skips cleanly until the next day instead of failing and re-hammering the API.
2. **SEO scoring** — every lead is scored 0–100 on SEO weakness using a penalty model: `100 − pagePenalty − reviewPenalty − ratingPenalty − noWebsitePenalty`. Page depth dominates (page 1 → 0, page 3 → 40, page 5+ → 65). Leads scoring 65+ are suppressed/deleted before they ever reach generation. Scraping adds on-page signals (missing title, meta description, mobile viewport, H1, thin content), merged 60/40 site/discovery.
3. **Scraping** — each lead's website is fetched (with timeout/redirect handling), text is extracted with Cheerio, and emails are pulled via regex + `mailto:` links. Leads with no discoverable email are deleted and suppressed.
4. **Email sourcing for no-website leads** — businesses without a website get an email search (DuckDuckGo HTML) instead of scraping; found emails move the lead to `scraped` with a "build a website" pitch, otherwise the lead is deleted.
5. **Generation** — DeepSeek writes a subject + body with strict style rules (no em dashes, no corporate filler, no template-triplet phrasing, one specific detail from the scraped content as the opener, 3–5 sentences), returning strict JSON.
6. **Sending** — initial emails go out via Resend, weakest-SEO first, within the daily cap. Exactly one follow-up is sent 7+ days later per lead, on a separate daily budget.
7. **Niche expansion** — when no active niches remain, the AI proposes 3–5 new industry/city combinations (with reasoning) so the pipeline keeps running on its own.

Stage failures send an alert email to the operator instead of halting the run. Each stage is bounded per run (e.g. 5 niches, 12 scrapes, 8 generations, 8 email searches) so it fits inside Vercel's function timeout.

## Tech stack

- **Next.js 16** (App Router, TypeScript, Tailwind CSS v4) — dashboard + API routes
- **Neon** (serverless Postgres) via plain `pg`, no ORM — 5 tables: `niches`, `leads`, `settings`, `suppressed_places`, `suppressed_emails`
- **Google Places API (New)** — business discovery
- **DeepSeek API** — email/follow-up generation and niche suggestion
- **Resend** — email delivery + open-tracking/bounce/complaint webhook
- **GitHub Actions** — daily cron trigger

## Getting started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) — the dashboard loads directly (single operator, no auth).

### Environment variables

Create `.env.local` (never commit it):

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Neon Postgres connection string (pooled) |
| `GOOGLE_PLACES_API_KEY` | Places API (New) key, restricted to Places API only |
| `DEEPSEEK_API_KEY` | DeepSeek API key for email generation (or `AI_API_KEY`) |
| `RESEND_API_KEY` | Resend key with sending access |
| `SENDER_DOMAIN` | Verified sending domain (emails go out from `outreach@<domain>`) |
| `SENDER_NAME` | Optional display name shown as the sender (omitted if unset) |
| `REPLY_TO_EMAIL` | Where replies and pipeline failure alerts land |
| `RESEND_WEBHOOK_SECRET` | Resend webhook signing secret (`whsec_…`), used to verify webhook requests |

The GitHub Actions schedule additionally uses an `APP_URL` repository secret pointing at the deployed app.

The full account setup (domain, Resend verification, Google Cloud, Neon) and the exact SQL schema are documented in [`docs/build-guide.md`](docs/build-guide.md) and [`docs/prd.md`](docs/prd.md).

## Dashboard

Three tabs, backed by `app/page.tsx` + `components/DashboardClient.tsx`:

- **Leads Directory** — all leads with pipeline status, SEO weakness badge, website, email, sent timestamps and open engagement; filterable by status (`new`, `scraped`, `generated`, `sent`, `followed_up`, `no_website`, `failed`), searchable, paginated (10/25/50 per page), with a modal to read each generated email.
- **Targeting Matrix** — multi-select industries and US cities (minimum 3 of each enforced), the resulting `industries × cities` search-pool count, an add-custom-niche form, and the full niche registry with status/source/reasoning.
- **Pipeline Settings** — daily send cap (1–100; initial sends hard-capped at 50/day, follow-ups on a separate 50/day budget) and an emergency pause toggle that halts all sending.

## API routes

- `GET /api/run-pipeline` — runs the pipeline loop over leads already in the database (send backlog, then scraping → email sourcing → generation); returns per-stage results and whether more work remains (the GitHub Action loops on this). Does **not** call Google Places.
- `GET /api/discover` — discovers new businesses from Google Places for active niches, enforces the daily Places call budget, marks genuinely exhausted niches, and triggers AI niche expansion. Runs independently; a failure here never affects `/api/run-pipeline`.
- `POST /api/settings` — update settings, save targeting matrix, add a custom niche.
- `POST /api/webhooks/resend` — records Resend `email.opened` events against leads, and handles `email.bounced`/`email.complained`: the lead is marked failed and the address is added to `suppressed_emails` so it can never be sent to again. The daily pipeline run also monitors 24h bounce/complaint counts and alerts the operator if they cross thresholds.

## Automation

`.github/workflows/daily-run.yml` runs the pipeline via a daily cron (`13:00 UTC`): first it calls `GET $APP_URL/api/discover` once to top up leads, then it calls `GET $APP_URL/api/run-pipeline` repeatedly until no work remains.

The Places daily budget needs two extra columns on the `settings` row — apply the idempotent migration in [`docs/sql/add-places-budget.sql`](docs/sql/add-places-budget.sql) (Neon SQL Editor) before enabling discovery.
