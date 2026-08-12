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

Stage failures are recorded in the `errors` table and shown on the dashboard's Error Log tab instead of halting the run. Each stage is bounded per run (e.g. 5 niches, 12 scrapes, 8 generations, 8 email searches) so it fits inside Vercel's function timeout.

## Tech stack

- **Next.js 16** (App Router, TypeScript, Tailwind CSS v4) — dashboard + API routes
- **Neon** (serverless Postgres) via plain `pg`, no ORM — 6 tables: `niches`, `leads`, `settings`, `suppressed_places`, `suppressed_emails`, `errors`
- **Google Places API (New)** — business discovery
- **DeepSeek API** — email/follow-up generation and niche suggestion
- **Resend** — email delivery + open-tracking/bounce/complaint webhook
- **GitHub Actions** — daily cron trigger
- **Vercel** — hosting

## Setup guide

Follow these steps in order — later steps depend on earlier ones (the schema in step 3 must exist before the app can start; the app must be deployed in step 6 before automation in step 7 can call it). For the original build-by-milestone spec with acceptance tests for each step, see [`docs/build-guide.md`](docs/build-guide.md).

### 1. Clone and install

```bash
git clone https://github.com/Jephtaah/ColdStart.git
cd ColdStart
npm install
```

Requires Node.js 20.9 or later.

### 2. Create the accounts you need

| Service | What to do | You'll get |
|---|---|---|
| [Neon](https://neon.tech) | New Project. In the connection details panel, copy the **pooled** connection string (hostname contains `-pooler`) for runtime use, and separately the **direct** connection string for the one-time schema setup in step 3. | `DATABASE_URL` |
| [Resend](https://resend.com) | Buy a domain first if you don't have one (any registrar, ~$10-12/yr — it doesn't need to match your portfolio). Domains → Add Domain → add the SPF/DKIM DNS records Resend gives you at your registrar → click Verify (can take minutes to hours). Then API Keys → Create → "Sending access" permission only. Also toggle **Open Tracking** on under the domain's settings. | `RESEND_API_KEY`, `SENDER_DOMAIN`, and later `RESEND_WEBHOOK_SECRET` |
| [Google Cloud](https://console.cloud.google.com) | New Project → enable "Places API (New)" → Credentials → Create API Key → restrict it to Places API only. Set a billing budget alert (e.g. $10) — you get monthly free credit but want a tripwire. | `GOOGLE_PLACES_API_KEY` |
| [DeepSeek](https://platform.deepseek.com) | Sign up → API Keys → create one. | `DEEPSEEK_API_KEY` |
| [Vercel](https://vercel.com) | Connect your GitHub account (used for deployment in step 6). | — |

You only need to receive replies in your normal inbox — no mail hosting or MX records on the new domain, just the SPF/DKIM records Resend asks for.

### 3. Create the database schema

Open the Neon SQL editor and run the full schema from [`docs/build-guide.md` (M2)](docs/build-guide.md#m2--database-schema) using the **direct** (non-pooled) connection string — schema changes are the one case where the pooled connection can misbehave. It creates all 6 tables (`niches`, `leads`, `settings`, `suppressed_places`, `suppressed_emails`, `errors`) and seeds the default 3×3 industry/city matrix.

### 4. Configure environment variables

Create `.env.local` in the project root (this file is gitignored — never commit it):

```bash
DATABASE_URL=postgresql://...-pooler.../neondb?sslmode=verify-full
GOOGLE_PLACES_API_KEY=
DEEPSEEK_API_KEY=
RESEND_API_KEY=
SENDER_DOMAIN=yourdomain.com
SENDER_NAME=Your Name
REPLY_TO_EMAIL=you@example.com
RESEND_WEBHOOK_SECRET=
CRON_SECRET=
DASHBOARD_PASSWORD=
```

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Neon Postgres connection string (pooled) |
| `GOOGLE_PLACES_API_KEY` | Places API (New) key, restricted to Places API only |
| `DEEPSEEK_API_KEY` | DeepSeek API key for email generation (or `AI_API_KEY`) |
| `RESEND_API_KEY` | Resend key with sending access |
| `SENDER_DOMAIN` | Verified sending domain (emails go out from `outreach@<domain>`) |
| `SENDER_NAME` | Optional display name shown as the sender (omitted if unset) |
| `REPLY_TO_EMAIL` | Where replies land |
| `RESEND_WEBHOOK_SECRET` | Resend webhook signing secret (`whsec_…`); generated in step 5, used to verify webhook requests |
| `CRON_SECRET` | Shared secret protecting `/api/discover` and `/api/run-pipeline`; generate any long random string (e.g. `openssl rand -hex 32`). Must be set in both Vercel and as a `CRON_SECRET` repository secret in GitHub (step 7). |
| `DASHBOARD_PASSWORD` | Password gating `/dashboard` and `/api/settings`. Pick a strong, unique password — required in any publicly reachable deployment; without it the dashboard is unreachable (fails closed) rather than open. |

### 5. Set up the Resend webhook

In the Resend dashboard: Webhooks → Add Endpoint → URL `https://<your-deployed-domain>/api/webhooks/resend` (you'll have this after step 6) → subscribe to `email.opened`, `email.bounced`, `email.complained` → copy the signing secret into `RESEND_WEBHOOK_SECRET`.

### 6. Run locally, then deploy

```bash
npm run dev
```

- [http://localhost:3000](http://localhost:3000) — public landing page
- [http://localhost:3000/dashboard](http://localhost:3000/dashboard) — operator dashboard, redirects to `/login` until you enter `DASHBOARD_PASSWORD`

To deploy: push the repo to GitHub, import it in Vercel, and add every variable from step 4 to the Vercel project's Environment Variables. Redeploy after adding them.

### 7. Automate the daily run

The pipeline doesn't run itself until GitHub Actions is wired up:

1. In your GitHub repo settings → Secrets and variables → Actions, add:
   - `APP_URL` — your deployed Vercel URL (e.g. `https://coldstart.vercel.app`)
   - `CRON_SECRET` — the same value as in Vercel
2. The workflow at [`.github/workflows/daily-run.yml`](.github/workflows/daily-run.yml) is already in the repo — it runs daily at 13:00 UTC, calling `/api/discover` once then `/api/run-pipeline` repeatedly until the backlog drains. Adjust the cron schedule if you want a different time.
3. Trigger it manually once from the Actions tab (`workflow_dispatch`) to confirm it works end to end before waiting for the schedule.

## Dashboard

Three tabs plus an error log, backed by `app/dashboard/page.tsx` + `components/DashboardClient.tsx`:

- **Leads Directory** — all leads with pipeline status, SEO weakness badge, website, email, sent timestamps and open engagement; filterable by status (`new`, `scraped`, `generated`, `sent`, `followed_up`, `no_website`, `failed`), searchable, paginated (10/25/50 per page), with a modal to read each generated email.
- **Targeting Matrix** — multi-select industries and US cities (minimum 3 of each enforced), the resulting `industries × cities` search-pool count, an add-custom-niche form, and the full niche registry with status/source/reasoning.
- **Pipeline Settings** — daily send cap (1–100; initial sends hard-capped at 50/day, follow-ups on a separate 50/day budget) and an emergency pause toggle that halts all sending.
- **Error Log** — pipeline and discovery stage failures recorded in the `errors` table, with a modal to inspect full error details.

Access is gated by `DASHBOARD_PASSWORD` (see [`proxy.ts`](proxy.ts) and [`lib/dashboardAuth.ts`](lib/dashboardAuth.ts)); logging in at `/login` sets a session cookie for the browser. The cookie is session-only (cleared when the browser closes) — there's no separate logout control by design.

## API routes

- `GET /api/run-pipeline` — runs the pipeline loop over leads already in the database (send backlog, then scraping → email sourcing → generation); returns per-stage results and whether more work remains (the GitHub Action loops on this). Does **not** call Google Places. Requires the `x-cron-secret` header.
- `GET /api/discover` — discovers new businesses from Google Places for active niches, enforces the daily Places call budget, marks genuinely exhausted niches, and triggers AI niche expansion. Runs independently; a failure here never affects `/api/run-pipeline`. Requires the `x-cron-secret` header.
- `POST /api/settings` — update settings, save targeting matrix, add a custom niche. Requires a valid dashboard session (browser cookie).
- `POST /api/webhooks/resend` — records Resend `email.opened` events against leads, and handles `email.bounced`/`email.complained`: the lead is marked failed and the address is added to `suppressed_emails` so it can never be sent to again. Verifies Resend's HMAC signature itself. The daily pipeline run also monitors 24h bounce/complaint counts and records a `pipeline` error in the `errors` table if they cross thresholds.
- `POST /api/login` — verifies `DASHBOARD_PASSWORD` and sets the dashboard session cookie.

## Automation

`.github/workflows/daily-run.yml` runs the pipeline via a daily cron (`13:00 UTC`): first it calls `GET $APP_URL/api/discover` once to top up leads, then it calls `GET $APP_URL/api/run-pipeline` repeatedly until no work remains.

## License

[MIT](LICENSE)
