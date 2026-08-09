# Cold Outreach Automation — Milestones & Build Guide

## How to use this document

Each milestone has: an objective, exact setup steps (accounts, SQL, config — do these yourself, they're not code the AI needs to write), an **AI prompt** you can paste as-is to generate the actual code, and an acceptance test so you know when it's really done before moving on.

Work through milestones in order. Don't skip ahead — M3 needs M2's tables to exist, M6 needs M5's output format, etc. When you paste an AI prompt, paste it in a **fresh chat** with just that milestone's context (I've included what it needs to know inline) — don't rely on the AI remembering earlier milestones across separate chats.

Stack for the whole project: **Next.js (App Router, TypeScript), Tailwind CSS, Neon (serverless Postgres), Resend, DeepSeek API, deployed on Vercel.**

---

## M0 — Accounts & environment setup

**Objective:** every account and key you need exists before any code is written.

**Steps (do these yourself, in this order):**

1. **Buy a domain.** Porkbun or Namecheap, ~$10-12/yr. Anything short and clean works — it doesn't need to match your portfolio.
2. **Create a Resend account** at resend.com → Domains → Add Domain → enter your new domain → Resend gives you DNS records (SPF, DKIM, sometimes DMARC) → add those exact records at your domain registrar's DNS settings → back in Resend, click Verify. This can take a few minutes to a few hours to propagate. Don't move on until it shows "Verified."
3. **Create a Resend API key**: Resend dashboard → API Keys → Create → permission "Sending access" (not full access) → copy it somewhere safe, you won't see it again.
4. **Enable open tracking on the domain**: Resend dashboard → your domain → Settings → toggle Open Tracking on.
5. **Google Cloud project**: console.cloud.google.com → New Project → enable "Places API (New)" → APIs & Services → Credentials → Create API Key → restrict it to Places API only (Credentials → edit key → API restrictions). Then go to Billing → set a budget alert (e.g. $10) so you get emailed if usage spikes — you get monthly free credit, but you want a tripwire, not a surprise.
6. **DeepSeek API key**: platform.deepseek.com → sign up → API Keys → create one, copy it.
7. **Neon project**: neon.tech → New Project → in the connection details panel, toggle "Pooled connection" on and copy that connection string (the hostname will contain `-pooler` in it) — this is what the app uses at runtime. Also copy the non-pooled ("Direct connection") string separately; you'll want it once, in M2, for creating the tables.
8. **GitHub repo**: create a new private repo for this project. You'll push code here — GitHub Actions (used later for scheduling) needs the repo to exist.
9. **Vercel account**: vercel.com, connect your GitHub account (you'll deploy from here in a later milestone, not yet).

**Env vars you now have** (write these down, you'll need them repeatedly — do not commit this file to git):
```
RESEND_API_KEY=
GOOGLE_PLACES_API_KEY=
DEEPSEEK_API_KEY=
DATABASE_URL=your-neon-pooled-connection-string
SENDER_DOMAIN=yourdomain.com
SENDER_NAME=Jephtah Okezie
REPLY_TO_EMAIL=okeziejephtah@gmail.com
CRON_SECRET=a-long-random-string   # generated later, in M8, for the cron workflow
```
`CRON_SECRET` is generated when you reach M8 (it protects `/api/discover` and `/api/run-pipeline`); add it to `.env.local` now so it's not forgotten. The automation endpoints fail closed — if `CRON_SECRET` is unset they reject every request with 401, so the secret must be set in both `.env.local` and Vercel before the workflow will pass.

Note on the new domain's DNS: you only need the SPF/DKIM (sending) records Resend gives you. No MX records, no mail hosting — replies get routed back to your Gmail via `REPLY_TO_EMAIL` in M6, not by receiving mail on the new domain at all.
```
```

**Acceptance test:** you can send one manual test email from the Resend dashboard using your verified domain, and it arrives without going to spam.

---

## M1 — Project scaffold

**Objective:** a working Next.js app with all dependencies installed, connected to Neon, deployed once so the pipeline exists end-to-end.

**Steps (run yourself):**
```bash
npx create-next-app@latest cold-outreach --typescript --tailwind --app --no-src-dir
cd cold-outreach
npm install pg @vercel/functions resend cheerio
npm install -D @types/pg
```

Create `.env.local` in the project root with all the env vars from M0 (never commit this — `.gitignore` already excludes it by default in create-next-app). `DATABASE_URL` should be the **pooled** connection string from Neon (the one with `-pooler` in the hostname) — this matters, a non-pooled connection will run out of connections quickly once the daily automation and the dashboard are both hitting the database.

Create `lib/db.ts`:
```typescript
import { Pool } from 'pg'
import { attachDatabasePool } from '@vercel/functions'

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
})

// Lets Vercel's runtime close idle connections cleanly between invocations
// instead of leaking them — safe to call once at module load.
attachDatabasePool(pool)
```

Every other milestone's code queries the database through this `pool` with plain parameterized SQL, e.g. `pool.query('select * from leads where status = $1', ['new'])` — no ORM, nothing Neon-specific, just standard `pg`.

Push to your GitHub repo, connect the repo in Vercel, add all env vars in Vercel's project settings (Settings → Environment Variables), deploy once.

**Acceptance test:** the default Next.js homepage loads at your Vercel URL.

---

## M2 — Database schema

**Objective:** the 6 tables the system actually uses exist in Neon.

**Steps:** Neon console → SQL Editor → paste and run this exactly. (Use the **direct/non-pooled** connection for this one-time step, not the pooled string — schema changes are the one case where the pooled connection can behave oddly.)

```sql
create table niches (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  city text not null,
  status text not null default 'active', -- 'active' | 'exhausted'
  source text not null default 'seed', -- 'seed' | 'ai_suggested'
  reasoning text,
  created_at timestamptz not null default now()
);

create table leads (
  id uuid primary key default gen_random_uuid(),
  niche_id uuid references niches(id),
  business_name text not null,
  address text,
  website text,
  email text,
  place_id text unique,
  status text not null default 'new', -- 'new' | 'scraped' | 'generated' | 'sent' | 'followed_up' | 'no_website' | 'failed'
  seo_score int, -- 0 (weakest SEO, top outreach priority) to 100 (strongest); >= 65 is hard-skipped
  seo_flags text, -- comma-separated weakness flags: no_title, no_meta_description, no_viewport, no_h1, thin_content, low_review_count, deep_result_page_N
  scraped_content text,
  generated_subject text,
  generated_body text,
  initial_sent_at timestamptz,
  initial_opened_at timestamptz,
  initial_resend_id text,
  followup_subject text,
  followup_body text,
  followup_sent_at timestamptz,
  followup_opened_at timestamptz,
  followup_resend_id text,
  bounced_at timestamptz, -- set by the Resend webhook when the address bounces or complains
  created_at timestamptz not null default now()
);

create table settings (
  id int primary key default 1,
  daily_cap int not null default 100,
  paused boolean not null default false,
  last_run_at timestamptz,
  places_used_date date, -- UTC date of the current daily Places quota window (null until first call)
  places_used_count int not null default 0, -- billable Google Places calls used today
  constraint single_row check (id = 1)
);

-- Addresses that bounced or complained. The sender, follow-up, and email
-- sourcing code never touch these again, even if the lead row is later deleted.
create table suppressed_emails (
  email text primary key, -- always stored lowercase
  reason text not null default 'bounce', -- 'bounce' | 'complaint'
  created_at timestamptz not null default now()
);

-- Google Places ids that should never be discovered again (already tried, or
-- scored at/above the send cutoff). Kept forever so discovery can't re-add them.
create table suppressed_places (
  place_id text primary key,
  created_at timestamptz not null default now()
);

-- Persisted stage failures from /api/discover and /api/run-pipeline so the
-- dashboard can surface them instead of relying on alert emails alone.
create table errors (
  id uuid primary key default gen_random_uuid(),
  source text not null, -- 'discover' | 'pipeline'
  stage text not null, -- e.g. 'discovery', 'scraping', 'email_sourcing', 'generation', 'sending', 'followups'
  message text not null,
  context jsonb,
  created_at timestamptz not null default now()
);
create index errors_created_at_idx on errors (created_at desc);

insert into settings (id, daily_cap, paused) values (1, 100, false);
```

Then seed your starting niches — 3 default industries × 3 default cities (9 active search pools):
```sql
insert into niches (label, city, status, source) values
  ('garage door repair', 'Dallas, TX', 'active', 'seed'),
  ('garage door repair', 'Austin, TX', 'active', 'seed'),
  ('garage door repair', 'Miami, FL', 'active', 'seed'),
  ('chiropractor', 'Dallas, TX', 'active', 'seed'),
  ('chiropractor', 'Austin, TX', 'active', 'seed'),
  ('chiropractor', 'Miami, FL', 'active', 'seed'),
  ('roofing contractor', 'Dallas, TX', 'active', 'seed'),
  ('roofing contractor', 'Austin, TX', 'active', 'seed'),
  ('roofing contractor', 'Miami, FL', 'active', 'seed');
```

**Acceptance test:** `select * from niches;` and `select * from settings;` return the rows above, `\dt` (or the Tables view) shows all 6 tables, and an empty `select * from suppressed_emails;`, `select * from suppressed_places;`, and `select * from errors;` return no rows.

---

## M3 — Business discovery (Google Places)

**Objective:** given an active niche, pull a list of real businesses with name, address, website (if present), and place_id, and insert new ones into `leads` (skipping duplicates by `place_id`).

**What it needs to do:**
- Call Google Places Text Search (New): `POST https://places.googleapis.com/v1/places:searchText`
- Headers: `X-Goog-Api-Key: <key>`, `X-Goog-FieldMask: places.id,places.displayName,places.formattedAddress,places.websiteUri,places.rating,places.userRatingCount,nextPageToken`
- Body: `{ "textQuery": "<niche label> in <city>" }`
- Paginate with `nextPageToken` up to `MAX_PLACES_PAGES_PER_NICHE` (3) pages, but only keep the deep pages — skip the first `PLACES_PAGES_TO_SKIP` (2) prominence-ranked pages so outreach targets the businesses that rank low on Google.
- Every page fetch is one billable call, reserved atomically against the daily Places budget (`MAX_PLACES_CALLS_PER_DAY`, tracked in `settings.places_used_date` / `places_used_count` via `consumePlacesQuota`). When the budget is spent, stop paginating and mark the run `quota_exhausted` — never fail or retry into the API.
- For each kept place, skip it if its `place_id` is already in `leads` or `suppressed_places`. Score discovery signals (website, rating, review count, page depth); places scoring at/above the send cutoff are suppressed and never stored. Insert the rest with status `'new'` (has a `websiteUri`) or `'no_website'` (no website).
- Return `DiscoverResult { inserted, status }` where `status` is `'ok'` (clean completion), `'partial'` (a transient fetch error stopped pagination — proves nothing about exhaustion), or `'quota_exhausted'`.

**AI prompt to paste:**
> Write a TypeScript function `discoverBusinesses(nicheLabel: string, city: string, nicheId: string): Promise<DiscoverResult>` in `lib/discovery.ts` for a Next.js app using a Postgres pool (`pool` from `lib/db.ts`) and Google Places API (New). For each page call `POST https://places.googleapis.com/v1/places:searchText` with headers `X-Goog-Api-Key` from `process.env.GOOGLE_PLACES_API_KEY` and `X-Goog-FieldMask: places.id,places.displayName,places.formattedAddress,places.websiteUri,places.rating,places.userRatingCount,nextPageToken`, body `{ textQuery: "${nicheLabel} in ${city}" }` (plus `pageToken` on later pages). Before each page fetch reserve one call with `consumePlacesQuota(1)` and stop paginating with status `'quota_exhausted'` if it returns false; also stop on HTTP 429/403. Keep only pages with index >= `PLACES_PAGES_TO_SKIP`. For each kept place, skip ones already present in `leads` or `suppressed_places`; score discovery signals and suppress/skip places scoring at/above `MAX_SEO_SCORE_TO_SEND`; otherwise insert a row with `business_name`, `address`, `website` (null if absent), `place_id`, `niche_id`, and `status` `'new'` (has website) or `'no_website'` (no website). Return `{ inserted, status }` where a transient non-quota fetch error after the first page sets `status` to `'partial'`.

**Acceptance test:** running this function for one seeded niche adds real businesses (both with and without websites) to the `leads` table, running it twice in a row doesn't create duplicates, and once `settings.places_used_count` reaches `MAX_PLACES_CALLS_PER_DAY` it returns `{ inserted: 0, status: 'quota_exhausted' }` without calling Google.

---

## M4 — Website scraping & email sourcing

**Objective:** for a lead with status `'new'`, extract site text and contact email (if website exists), route no-website leads into the search-based email sourcing pool, and discard leads where no address can be found at all.

**What it needs to do:**
- If the lead has a `website`:
  - Fetch the `website` URL (add `https://` if missing, handle redirects).
  - Parse HTML with `cheerio`, strip `<script>`, `<style>`, `<nav>`, `<footer>` tags, extract visible text (truncate to 3000 characters).
  - Extract emails from the homepage and linked `/contact` or `/about` pages using email regex matching and `mailto:` link parsing.
  - Reconcile/cross-match any discovered site email with existing Google Places email info, updating the lead's `email` column (preferring site email).
- If the lead has NO `website` (`website` is null/empty):
  - Skip HTTP fetch. Set `status = 'no_website'` so the email-sourcing stage (`lib/emailfinder.ts`) can search DuckDuckGo for the business's email. No fallback content is stored here.
- If the site fetch succeeds but no email is found from any source, delete the lead and suppress its `place_id` (lean DB — nothing useless is kept).
- Update lead row: set `scraped_content`, updated `email` (if found), and `status` to `'scraped'`.

**AI prompt to paste:**
> Write a TypeScript function `scrapeWebsite(leadId: string)` for a Next.js app using the `cheerio` package and a Postgres connection pool (`pool` from `lib/db.ts`). It should: fetch the lead row by `id` from the `leads` table (selecting `website`, `email`, `business_name`, `address`, `place_id`).
> 1. If `website` is null or empty: set `status` to `'no_website'` and return false — the lead must go through the email-sourcing pool, not fallback content.
> 2. If `website` is present: fetch the URL (add `https://` prefix if missing, 10s timeout, follow redirects), parse HTML with cheerio, remove `script`, `style`, `nav`, `footer` elements, extract visible text (collapse whitespace, truncate to 3000 chars) for `scraped_content`. Also scan the HTML and `mailto:` hrefs (and check `/contact` or `/about` if linked) for email addresses using regex. If a valid email is found, set `email` to that address (cross-matching/preferring website email); if no email is found from any source, delete the lead row and insert its `place_id` into `suppressed_places` (ON CONFLICT DO NOTHING), then return false.
> 3. Otherwise update the lead row setting `scraped_content`, `email`, and `status = 'scraped'`. Return true for success.

**Acceptance test:** run it against 5-10 real leads from M3; leads with sites get readable `scraped_content` and extracted `email`, leads without sites move to `status = 'no_website'`, and any site lead with no findable email is deleted and suppressed.

---

## M5 — AI email generation

**Objective:** for a lead with status `'scraped'`, generate a subject + body cold email using an AI API (e.g. DeepSeek) tailored to whether they have an existing website or not, then set status to `'generated'`.

**Style rules the prompt must enforce** (these are Jephtah's known preferences — don't loosen them):
- No em dashes anywhere in the output.
- No corporate filler phrases ("I hope this finds you well," "reaching out," "circle back," etc.)
- No parallel-triplet sentence structures ("fast, reliable, and affordable") — that's a dead giveaway of AI writing.
- **Differentiated Pitch Angle**:
  - **If lead has NO website (`website` is null)**: Pitch building a clean, modern website from scratch to start capturing local online leads and calls.
  - **If lead HAS a website**: Open with one specific, genuine detail pulled from the scraped content (no generic compliments). Pitch site modifications/redesign & SEO optimization to help them rank higher on Google Search & Maps.
- No pitch in the first line. Ask a question or make an observation that naturally bridges toward what you do, don't sell in sentence one.
- Should read like a real person wrote it in two minutes, not a marketing template.
- Keep it short — 3-5 sentences total.

**AI prompt to paste** (this is the *build* prompt — it generates the code, and the code itself contains the *email-writing* prompt below):
> Write a TypeScript function `generateEmail(leadId: string)` for a Next.js app that calls an AI API (OpenAI-compatible, e.g., DeepSeek endpoint `https://api.deepseek.com/chat/completions`, model from `lib/constants.ts` `DEEPSEEK_MODEL`, API key from `process.env.DEEPSEEK_API_KEY` — fall back to `process.env.AI_API_KEY`) and a Postgres connection pool (`pool` from `lib/db.ts`). It should: fetch the lead row by `id` (needs `business_name`, `website`, `email`, and `scraped_content` fields). If `email` is null or empty, update `status = 'failed'` and return. Build a system prompt instructing the model to write a short cold email introducing a freelance web developer's services, enforcing these rules: no em dashes, no corporate filler phrases, no parallel-triplet phrasing, no pitch in sentence 1, 3-5 sentences total, casual human tone.
> - If `website` is null: pitch building a modern website from scratch to help them capture local leads searching for their services online.
> - If `website` is present: open with one specific real detail from `scraped_content`, then pitch site modifications/redesign and SEO optimization to help them rank higher on Google Search & Maps.
> Ask the model to return strict JSON: `{ "subject": string, "body": string }` and nothing else. The AI response may wrap the JSON in markdown code fences — strip any leading/trailing ``` before parsing. Parse that JSON from the response, update the `leads` row with a parameterized `UPDATE`: set `generated_subject`, `generated_body`, and `status` to `'generated'`. Handle JSON parse failures by retrying once before giving up and setting `status` to `'failed'`.

**Important:** the first 15-20 outputs from this milestone need your own eyes before you trust it running unattended. Read them. If they still sound templated, the system prompt needs tightening — paste 2-3 bad examples back to your AI assistant and ask it to revise the prompt until it stops producing them.

**Acceptance test:** you read 15-20 generated emails across leads with and without websites, and confirm the pitch angles match their website status and sound natural.

---

## M6 — Sending pipeline

**Objective:** send the generated email for a lead via Resend, respecting the daily cap, and log the result.

**What it needs to do:**
- Check `settings.paused` — if true, do nothing.
- Check how many leads already have `initial_sent_at` set to today's date — if that count is at or above the effective cap (`min(settings.daily_cap, MAX_INITIAL_SENDS_PER_DAY)`), stop for today. Follow-ups use a separate budget (`MAX_FOLLOWUPS_PER_DAY`), so the initial-send cap only limits initial sends.
- For each lead with status `'generated'` (up to the remaining cap for today): send via Resend from `noreply@<your domain>` (or a name you prefer @ your domain), set `initial_sent_at` to now, store Resend's returned message id in `initial_resend_id`, set `status` to `'sent'`.
- If a send fails, set `status` to `'failed'`, don't stop the whole batch.

**AI prompt to paste:**
> Write a TypeScript function `sendBatch()` for a Next.js app using the `resend` npm package (API key from `process.env.RESEND_API_KEY`) and a Postgres connection pool (already set up as `pool` from `lib/db.ts`, a standard `pg` `Pool`). It should: read the single row from the `settings` table; if `paused` is true, return immediately. Otherwise count leads where `initial_sent_at` is today's date (UTC), and compute `remaining = min(daily_cap, MAX_INITIAL_SENDS_PER_DAY) - that count`. If `remaining <= 0`, return. Otherwise fetch up to `remaining` leads with `status = 'generated'`, and for each one send an email via Resend (from `outreach@${process.env.SENDER_DOMAIN}`, to the lead's `email`, using `generated_subject` and `generated_body` as plain text or simple HTML), then update that lead with a parameterized `UPDATE`: set `initial_sent_at` to now, `initial_resend_id` to the id Resend returns, `status` to `'sent'`. If the Resend call throws, instead set `status` to `'failed'` and continue to the next lead rather than stopping. Return the number of emails successfully sent.

**Acceptance test:** run it manually against 2-3 real leads first (not the whole batch) and confirm they arrive, look right, and the `leads` table updates correctly.

---

## M7 — Follow-up logic

**Objective:** exactly one follow-up email per lead, sent 7+ days after the initial send, only once.

**What it needs to do:**
- Find leads where `status = 'sent'`, `initial_sent_at` is 7 or more days ago, and `followup_sent_at` is still null.
- Generate a short follow-up (references the first email lightly, doesn't repeat the whole pitch, even shorter than the original).
- Send it the same way as M6, respecting its own daily cap (`MAX_FOLLOWUPS_PER_DAY` — follow-ups get a separate budget from the initial-send cap).
- Update `followup_subject`, `followup_body`, `followup_sent_at`, `followup_resend_id`, set `status` to `'followed_up'`.

**AI prompt to paste:**
> Write a TypeScript function `sendFollowUps()` for a Next.js app using DeepSeek (for generating the follow-up text, same setup as the `generateEmail` function, including stripping markdown code fences before parsing its JSON response), Resend (same setup as `sendBatch`), and a Postgres connection pool (`pool` from `lib/db.ts`). It should: find leads where `status = 'sent'`, `initial_sent_at` is more than 7 days ago, and `followup_sent_at` is null. Use the separate follow-up budget (count today's `followup_sent_at` rows against `MAX_FOLLOWUPS_PER_DAY`, not the initial-send cap). For each eligible lead, generate a short follow-up email (2-3 sentences, referencing that this is a quick follow-up to the earlier note, not repeating the full pitch, same style rules as before: no em dashes, no filler, sounds human) via DeepSeek returning JSON `{ "subject": string, "body": string }`, send it via Resend, then update the lead with a parameterized `UPDATE`: `followup_subject`, `followup_body`, `followup_sent_at` to now, `followup_resend_id`, `status` to `'followed_up'`. Handle failures per-lead without stopping the batch.

**Acceptance test:** manually backdate a test lead's `initial_sent_at` to 8 days ago (via Neon's SQL Editor), run the function, confirm the follow-up sends and the row updates correctly.

---

## M8 — Automation trigger (the daily runner)

**Objective:** two endpoints — `/api/discover` (find new leads) and `/api/run-pipeline` (process and send leads already in the database) — called automatically every day. Discovery is a separate route with its own failure mode, so a Google Places quota outage or timeout can never block scraping, generation, or sending.

**What the endpoints should do, in order:**
- Both `/api/discover` and `/api/run-pipeline` require cron auth first: they read `CRON_SECRET` and compare it (constant-time) against the `x-cron-secret` request header, rejecting with 401 when absent or mismatched. Fails closed when `CRON_SECRET` is unset.
- `GET /api/discover` — for each `niche` with `status = 'active'` (up to `MAX_NICHES_PER_RUN`): run discovery (M3). Skip cleanly (`skipped: 'quota_exhausted'`) when the daily Places budget is spent. Mark a niche `exhausted` only when discovery actually completed and found nothing new (never on a failed, partial, or quota-skipped run). When no active niches remain, trigger AI niche expansion.
- `GET /api/run-pipeline` — processes leads already in the database only; it never calls Google Places:
  1. Send gate: if generated leads are due or follow-ups are ready, drain a bounded batch.
  2. Otherwise produce: scrape leads with `status = 'new'` (M4), source emails for `no_website` leads, then generate for `status = 'scraped'` (M5).
  3. Update `settings.last_run_at` to now, and return `hasRemaining` so the runner loops until the backlog is drained.

**AI prompt to paste:**
> Write two Next.js App Router API routes. Both `app/api/discover/route.ts` (GET) and `app/api/run-pipeline/route.ts` (GET) must first check cron auth: read `CRON_SECRET` from the environment and compare it against the `x-cron-secret` request header with a constant-time comparison, returning `{ error: 'Unauthorized' }` with status 401 when it's missing or mismatched (and when `CRON_SECRET` is unset). For discover: fetch up to `MAX_NICHES_PER_RUN` niches with `status = 'active'` and call `discoverBusinesses(label, city, id)` for each; skip with `{ skipped: 'quota_exhausted' }` when `getPlacesQuotaRemaining()` is 0; stop after the first `status === 'quota_exhausted'` result; mark a niche `exhausted` only when the result has `inserted === 0 && status === 'ok'` and the niche has no pending leads; run `expandNiches()` when no active niches remain; return per-run counts. For run-pipeline: first compute today's remaining send caps (`settings.daily_cap` capped at `MAX_INITIAL_SENDS_PER_DAY`, and `MAX_FOLLOWUPS_PER_DAY` as a separate follow-up budget); if a send/follow-up backlog exists, call `sendBatch()`/`sendFollowUps()`; otherwise scrape leads with `status = 'new'`, source no-website emails, and generate for `status = 'scraped'`. Wrap each stage in try/catch so one failing stage doesn't stop the others, record failures to the `errors` table, update `settings.last_run_at`, and return `{ hasRemaining, results }` where `hasRemaining` reflects only send/follow-up/scrape/generate work still in the database.

**Then set up the schedule** — create `.github/workflows/daily-run.yml` in your repo (add `CRON_SECRET` to the repo secrets alongside `APP_URL`):
```yaml
name: Daily Outreach Run
on:
  schedule:
    - cron: '0 13 * * *'  # 13:00 UTC daily — adjust to your preferred time
  workflow_dispatch: {}     # lets you trigger it manually from GitHub's Actions tab too

# Only ever run one pipeline at a time: if a manual dispatch fires while the
# scheduled run is mid-drain, it waits instead of overlapping. Overlapping
# runs could both pick the same queued lead and send it twice.
concurrency:
  group: daily-outreach
  cancel-in-progress: false

jobs:
  run:
    runs-on: ubuntu-latest
    steps:
      - name: Discover new businesses
        env:
          APP_URL: ${{ secrets.APP_URL }}
          CRON_SECRET: ${{ secrets.CRON_SECRET }}
        run: |
          # Discovery runs on its own endpoint so a Google Places quota outage
          # (or timeout) can never hold up scraping/generation/sending below.
          # Fail the step on a network error (non-zero curl exit), a non-200
          # HTTP status (401 auth, 500, etc.), or an endpoint-reported failure
          # so the workflow surfaces it instead of silently passing.
          echo "--- discovery ---"
          RESPONSE=$(curl -sS -X GET -H "x-cron-secret: $CRON_SECRET" \
            -w $'\nHTTP_STATUS:%{http_code}' \
            "$APP_URL/api/discover") || exit 1
          echo "$RESPONSE"
          if ! echo "$RESPONSE" | grep -q 'HTTP_STATUS:200' || echo "$RESPONSE" | grep -q '"success":false'; then
            echo "::error::Discovery did not return HTTP 200 + success. Check APP_URL/CRON_SECRET and the errors table."
            exit 1
          fi

      - name: Run pipeline until backlog drained
        env:
          APP_URL: ${{ secrets.APP_URL }}
          CRON_SECRET: ${{ secrets.CRON_SECRET }}
        run: |
          FAILED=0
          for i in $(seq 1 40); do
            echo "--- pipeline iteration $i ---"
            RESPONSE=$(curl -sS -X GET -H "x-cron-secret: $CRON_SECRET" \
              -w $'\nHTTP_STATUS:%{http_code}' \
              "$APP_URL/api/run-pipeline") || true
            if [ -z "$RESPONSE" ] || ! echo "$RESPONSE" | grep -q 'HTTP_STATUS:200'; then
              echo "::warning::Pipeline iteration $i did not return HTTP 200 (check APP_URL/CRON_SECRET)."
              FAILED=1
              sleep 15
              continue
            fi
            if echo "$RESPONSE" | grep -q '"success":false'; then
              echo "::error::Pipeline run reported a failure; check the errors table."
              echo "$RESPONSE"
              exit 1
            fi
            echo "$RESPONSE"
            if ! echo "$RESPONSE" | grep -q '"hasRemaining":true'; then
              echo "Pipeline finished."
              exit $FAILED
            fi
            echo "More work remaining, waiting 15s before next iteration..."
            sleep 15
          done
          echo "::error::Pipeline reached max iterations without finishing."
          exit $FAILED
```

**Acceptance test:** trigger the workflow manually from GitHub's Actions tab (`workflow_dispatch`) and confirm discovery runs first, then the pipeline loops until `hasRemaining` is false — end to end without you touching anything else. Then leave the schedule alone for a day and check it fired on its own.

---

## M9 — Dashboard

**Objective:** a dashboard where you can see leads, niches, and settings without opening the database directly.

**What it needs:**
- A leads table: business name, status, sent/opened timestamps, filterable by status.
- A niches & targeting view: preset catalog of top US cities and industries in `lib/constants.ts`. Multi-select checkboxes for Industries and US Cities (enforcing minimum 3 of each selected at all times). Shows active `niches` combinations (e.g. 3 industries × 3 cities = 9 active search pools), with a form to manually add custom city/industry pairs.
- A settings panel: edit `daily_cap`, toggle `paused`.
- An errors view: the last ~200 rows from the `errors` table (source, stage, message, created_at), so pipeline/discovery failures are visible without opening the database.

**AI prompt to paste:**
> Define `lib/constants.ts` with lists of top US service industries (e.g. Garage Door Repair, Chiropractor, Roofing Contractor, Plumbing, HVAC) and top US cities (e.g. Dallas, TX; Austin, TX; Miami, FL; Houston, TX; Phoenix, AZ). Then write `app/page.tsx` as a Server Component dashboard querying Postgres (`pool` from `lib/db.ts`): fetch and display all rows from `leads` table in a table filterable by status. Add a Targeting section displaying current active `niches` rows alongside multi-select checkboxes for preset Industries and US Cities (enforcing a minimum selection of 3 industries and 3 cities; saving updates/inserts combination rows into `niches` with status 'active'). Also include a form to add custom niche/city pairs. Add a settings section showing `daily_cap` and `paused`, with an input to update `daily_cap` and a toggle for `paused` via a small API route. Use Tailwind CSS for clean styling.

**Acceptance test:** accessing `http://localhost:3000/` loads the dashboard with real data, you can toggle target cities/industries (enforcing min 3 of each), change daily cap, and toggle pause.

---

## M10 — Open tracking & bounce handling

**Objective:** know when a sent email gets opened, and react when one bounces or is complained about.

**What it needs:**
- A webhook endpoint that receives Resend's `email.opened`, `email.bounced`, and `email.complained` events, verifying each request's HMAC signature (Standard Webhooks `v1,<sig>` scheme, 5-minute timestamp tolerance) against `RESEND_WEBHOOK_SECRET` — reject with 401 when the secret is unset or the signature doesn't match.
- For `email.opened`: match the event's message id against `initial_resend_id` or `followup_resend_id` on a lead, and set the corresponding `initial_opened_at` or `followup_opened_at`.
- For `email.bounced` / `email.complained`: ignore temporary bounces; for permanent ones, mark the matching lead `status = 'failed'` with `bounced_at` set, and insert the address into `suppressed_emails` (reason `'bounce'` or `'complaint'`) so no sender, follow-up, or email-sourcing path touches it again.
- Register that webhook URL in the Resend dashboard (Webhooks → Add Endpoint).

**AI prompt to paste:**
> Write a Next.js App Router API route at `app/api/webhooks/resend/route.ts` with a `POST` handler that receives Resend webhook events, using the Postgres pool (`pool` from `lib/db.ts`). First read the raw request body as text and verify the Standard Webhooks signature: decode `RESEND_WEBHOOK_SECRET` from base64 (stripping a `whsec_` prefix if present), compute `base64(HMAC-SHA256(key, "<id>.<timestamp>.<rawBody>"))` using the `svix-id`/`svix-timestamp`/`svix-signature` headers (accept `webhook-*` as fallbacks), and compare constant-time against each `v1,<sig>` in the signature header, rejecting requests older than 5 minutes. If `RESEND_WEBHOOK_SECRET` is unset or verification fails, return 401. Parse the JSON body; if `type` is `"email.opened"`, get the `data.email_id` field, then run a parameterized `UPDATE` against the `leads` table for a row where `initial_resend_id` equals that id (set `initial_opened_at` to the current timestamp) or where `followup_resend_id` equals that id (set `followup_opened_at` to the current timestamp). If `type` is `"email.bounced"` or `"email.complained"` (skipping `data.bounce.type === 'Temporary'` for bounces), find the lead by `initial_resend_id`/`followup_resend_id`, set its `status` to `'failed'` and `bounced_at` to now, and insert the recipient address into `suppressed_emails` (lowercased) with reason `'bounce'` or `'complaint'` using `ON CONFLICT (email) DO NOTHING`. Return a 200 response for handled events regardless so Resend doesn't retry. Include basic error handling so a malformed payload doesn't crash the route.

Then in Resend dashboard: Webhooks → Add Endpoint → paste your deployed `/api/webhooks/resend` URL → subscribe to the `email.opened`, `email.bounced`, and `email.complained` events. Set `RESEND_WEBHOOK_SECRET` in `.env.local` and Vercel (a long random string; Resend shows the signing secret when you create the endpoint).

**Acceptance test:** send yourself a test email through the pipeline, open it from a different device/browser, and confirm `initial_opened_at` populates within a minute or two. Then intentionally send to a dead address (or use Resend's dashboard test bounce) and confirm the lead goes `failed` with `bounced_at` set and the address lands in `suppressed_emails`.

---

## M11 — Niche auto-expansion

**Objective:** when a niche runs out of new businesses to contact, the app picks new niches/cities on its own.

**What it needs to do:**
- A niche is "exhausted" when a discovery run for it returns zero *new* leads (all results were already duplicates).
- When that happens, mark it `status = 'exhausted'`, then ask the AI model to suggest 3-5 new niche/city combinations, given the list of niches already tried (so it doesn't repeat itself), and insert them as new `niches` rows with `source = 'ai_suggested'` and a `reasoning` field explaining why.

**AI prompt to paste:**
> Write a TypeScript function `expandNiches()` for a Next.js app using DeepSeek and a Postgres connection pool (`pool` from `lib/db.ts`). It should: fetch all rows from the `niches` table (label, city, status). If there are no niches with `status = 'active'`, call the DeepSeek API asking it to suggest 3-5 new local-business niche + city combinations suitable for cold outreach offering website development/optimization services, given the full list of niches already tried (to avoid repeats), returning strict JSON as an array of objects `{ "label": string, "city": string, "reasoning": string }` (strip any markdown code fences before parsing, same as `generateEmail`). Parse that JSON and insert each as a new row into `niches` with a parameterized `INSERT`: `status: 'active'`, `source: 'ai_suggested'`, and the given `reasoning`. Handle JSON parsing failures by logging the error and returning without inserting anything malformed.

Then update the M8 pipeline route: after a discovery run for a niche returns 0 new leads, set that niche's `status` to `'exhausted'`; after processing all active niches, if none remain active, call `expandNiches()`.

**Acceptance test:** manually mark all seeded niches as `'exhausted'` (via Neon's SQL Editor), run the pipeline manually, and confirm new, sensible niche rows appear with reasoning attached.

---

## M12 — Hardening

**Objective:** confident enough to leave it alone for a week without checking in daily.

**Tasks:**
- Failure visibility: every failed stage of `/api/discover` and `/api/run-pipeline` is persisted to the `errors` table (with source, stage, message, and context) so the dashboard can surface it. The cron workflow also fails loudly on non-200 responses, `"success":false`, or an exhausted iteration loop. Confirm a broken stage actually lands in `errors` and gets flagged by the workflow.
- Double check every external call (Places, AI API, Resend, website scraping) has a timeout and a try/catch — nothing should be able to hang the whole batch indefinitely. Each run stage is bounded by the per-run caps and the wall-clock budget (`RUN_BUDGET_MS`) so one invocation returns inside Vercel's serverless timeout and the workflow loop picks up the rest.
- Review the full dashboard against real data for a few days: are statuses accurate, are timestamps right, does pause actually pause.
- Re-read a fresh batch of 15-20 generated emails after a week of real-world use — tone can drift once it's running on new niches it suggested itself; tighten the M5 prompt again if needed.

**Acceptance test:** the pipeline runs unattended for 7 days, you get notified the one time something breaks (test this by intentionally breaking one API key temporarily), and the dashboard reflects reality throughout.

---

## M13 — Post-v1: SEO scoring rework, no-website segment, lean DB & pagination

**Objective:** fix targeting so the deepest-page businesses (the ones that need help most) score as weak instead of strong, add a reachable no-website segment, keep the database lean by deleting useless leads, and paginate the dashboard tables.

**What changed:**

1. **SEO scoring** (`lib/seo.ts`): replaced the score-up bucket model with a weakness-penalty model — `score = 100 − pagePenalty − reviewPenalty − ratingPenalty − noWebsitePenalty`. Page depth is dominant (page 3 → 40, page 5+ → 65). Site score and the 60/40 merge are unchanged; the send cutoff stays 65. New page-3 leads now score ~20–55 instead of ~70–85.
2. **No-website segment** (`lib/discovery.ts`): discovery keeps businesses without a website, inserting them with `status = 'no_website'` and the no-website penalty.
3. **Email sourcing** (new `lib/emailfinder.ts`): `sourceNoWebsiteEmails(max)` searches DuckDuckGo HTML for `"{business_name} {city}"`, fetches the top `MAX_EMAIL_SEARCH_RESULTS` (4) result URLs, and extracts emails reusing `extractEmails` / `extractEmailsFromHtml` from `lib/scraper.ts`. Found → lead moves to `scraped`; not found → lead is deleted and its `place_id` suppressed.
4. **Lean database:** high-SEO leads (merged score ≥ 65) are deleted and suppressed in the generation stage; discovery suppresses any place scoring ≥ 65 before inserting it; leads with no discoverable email are deleted. `failed` leads are kept.
5. **Pipeline** (`app/api/run-pipeline/route.ts`): new Stage 2b runs email sourcing with a per-run cap (`MAX_EMAIL_SEARCHES_PER_RUN = 4`) so Vercel function timeouts aren't blown.
6. **Dashboard** (`components/DashboardClient.tsx`): pagination on the Leads and Niches tables (10/25/50 per page, prev/next + numbered pages), a new `no_website` status tab, and removal of the `skipped` tab.

**Setup steps:** apply the M2 schema additions if you haven't already — `suppressed_places`, `suppressed_emails`, and the `settings.places_used_date` / `places_used_count` columns are all added in M2. No new environment variables, no new API keys.

**AI prompt to paste:** not applicable — this milestone was implemented directly against the existing codebase.

**Acceptance test:** trigger a manual pipeline run; confirm (1) newly discovered page-3 leads score 20–55 (Weak/Fair), (2) no-website leads either get an email and progress to `scraped` or are deleted, (3) no lead remains in the DB with `seo_score >= 65`, and (4) the dashboard Leads and Niches tables page correctly.
