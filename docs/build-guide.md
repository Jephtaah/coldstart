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
REPLY_TO_EMAIL=okeziejephtah@gmail.com
APP_SECRET=choose-a-secret-key
CRON_SECRET=generate-a-random-string
```

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

**Objective:** the 3 tables from the PRD exist in Neon.

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
  status text not null default 'new', -- 'new' | 'scraped' | 'generated' | 'sent' | 'followed_up' | 'failed'
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
  created_at timestamptz not null default now()
);

create table settings (
  id int primary key default 1,
  daily_cap int not null default 25,
  paused boolean not null default false,
  last_run_at timestamptz,
  constraint single_row check (id = 1)
);

insert into settings (id, daily_cap, paused) values (1, 25, false);
```

Then seed your starting niches — edit the list to your real targets:
```sql
insert into niches (label, city, status, source) values
  ('garage door repair', 'Dallas, TX', 'active', 'seed'),
  ('chiropractor', 'Dallas, TX', 'active', 'seed');
```

**Acceptance test:** `select * from niches;` and `select * from settings;` return the rows above, either in Neon's SQL Editor or its Tables view.

---

## M3 — Business discovery (Google Places)

**Objective:** given an active niche, pull a list of real businesses with name, address, website (if present), and place_id, and insert new ones into `leads` (skipping duplicates by `place_id`).

**What it needs to do:**
- Call Google Places Text Search (New): `POST https://places.googleapis.com/v1/places:searchText`
- Headers: `X-Goog-Api-Key: <key>`, `X-Goog-FieldMask: places.id,places.displayName,places.formattedAddress,places.websiteUri`
- Body: `{ "textQuery": "<niche label> in <city>" }`
- For each result, if `place_id` isn't already in the `leads` table, insert a new row with status `'new'`.
- Insert businesses whether they have a `websiteUri` or not (if `websiteUri` is absent, set `website` column to `null`).

**AI prompt to paste:**
> Write a TypeScript function `discoverBusinesses(nicheLabel: string, city: string, nicheId: string)` for a Next.js app using a Postgres connection pool (already set up as `pool` from `lib/db.ts`, a standard `pg` `Pool`) and Google Places API (New). It should: call `https://places.googleapis.com/v1/places:searchText` with header `X-Goog-Api-Key` from `process.env.GOOGLE_PLACES_API_KEY` and `X-Goog-FieldMask: places.id,places.displayName,places.formattedAddress,places.websiteUri`, body `{ textQuery: "${nicheLabel} in ${city}" }`. For each place in the response, check with a parameterized `pool.query` whether a lead with that `place_id` already exists in the `leads` table; if not, insert a new row with `business_name`, `address`, `website` (set to `place.websiteUri` or `null` if missing), `place_id`, `niche_id`, and `status: 'new'` using a parameterized `INSERT`. Return the count of new leads inserted. Include error handling if the API call fails.

**Acceptance test:** running this function for one seeded niche adds real businesses (both with and without websites) to the `leads` table, and running it twice in a row doesn't create duplicates.

---

## M4 — Website scraping & email sourcing

**Objective:** for a lead with status `'new'`, extract site text and contact email (if website exists), or prepare fallback context (if no website), cross-matching with Google Places email if present, then set status to `'scraped'`.

**What it needs to do:**
- If the lead has a `website`:
  - Fetch the `website` URL (add `https://` if missing, handle redirects).
  - Parse HTML with `cheerio`, strip `<script>`, `<style>`, `<nav>`, `<footer>` tags, extract visible text (truncate to 3000 characters).
  - Extract emails from the homepage and linked `/contact` or `/about` pages using email regex matching and `mailto:` link parsing.
  - Reconcile/cross-match any discovered site email with existing Google Places email info, updating the lead's `email` column (preferring site email).
- If the lead has NO `website` (`website` is null/empty):
  - Skip HTTP fetch. Set `scraped_content` to fallback text containing business name, address, and niche.
- Update lead row: set `scraped_content`, updated `email` (if found), and `status` to `'scraped'`.
- If site fetch fails and no email is available from any source, set `status` to `'failed'`.

**AI prompt to paste:**
> Write a TypeScript function `scrapeWebsite(leadId: string)` for a Next.js app using the `cheerio` package and a Postgres connection pool (`pool` from `lib/db.ts`). It should: fetch the lead row by `id` from the `leads` table (selecting `website`, `email`, `business_name`, `address`).
> 1. If `website` is null or empty: set `scraped_content` to `"Business Name: ${business_name}\nAddress: ${address}\nWebsite: None"`, keep existing `email` (if any), and set `status` to `'scraped'`.
> 2. If `website` is present: fetch the URL (add `https://` prefix if missing, 10s timeout, follow redirects), parse HTML with cheerio, remove `script`, `style`, `nav`, `footer` elements, extract visible text (collapse whitespace, truncate to 3000 chars) for `scraped_content`. Also scan the HTML and `mailto:` hrefs (and check `/contact` or `/about` if linked) for email addresses using regex. If a valid email is found on the website, set `email` to that address (cross-matching/preferring website email). Update the lead row setting `scraped_content`, `email`, and `status = 'scraped'`.
> 3. If fetching a site fails or throws, set `status` to `'failed'` (unless an email is already present on the lead row, in which case set `status` to `'scraped'` with fallback content). Return true/false for success.

**Acceptance test:** run it against 5-10 real leads from M3; leads with sites get readable `scraped_content` and extracted `email`, while leads without sites bypass scraping and update to `'scraped'` with fallback context.

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
> Write a TypeScript function `generateEmail(leadId: string)` for a Next.js app that calls an AI API (OpenAI-compatible, e.g., DeepSeek endpoint `https://api.deepseek.com/chat/completions`, model `deepseek-chat`, API key from `process.env.AI_API_KEY`) and a Postgres connection pool (`pool` from `lib/db.ts`). It should: fetch the lead row by `id` (needs `business_name`, `website`, `email`, and `scraped_content` fields). If `email` is null or empty, update `status = 'failed'` and return. Build a system prompt instructing the model to write a short cold email introducing a freelance web developer's services, enforcing these rules: no em dashes, no corporate filler phrases, no parallel-triplet phrasing, no pitch in sentence 1, 3-5 sentences total, casual human tone.
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
- Check how many leads already have `initial_sent_at` set to today's date — if that count is at or above `settings.daily_cap`, stop for today.
- For each lead with status `'generated'` (up to the remaining cap for today): send via Resend from `noreply@<your domain>` (or a name you prefer @ your domain), set `initial_sent_at` to now, store Resend's returned message id in `initial_resend_id`, set `status` to `'sent'`.
- If a send fails, set `status` to `'failed'`, don't stop the whole batch.

**AI prompt to paste:**
> Write a TypeScript function `sendBatch()` for a Next.js app using the `resend` npm package (API key from `process.env.RESEND_API_KEY`) and a Postgres connection pool (already set up as `pool` from `lib/db.ts`, a standard `pg` `Pool`). It should: read the single row from the `settings` table; if `paused` is true, return immediately. Otherwise count leads where `initial_sent_at` is today's date (UTC), and compute `remaining = daily_cap - that count`. If `remaining <= 0`, return. Otherwise fetch up to `remaining` leads with `status = 'generated'`, and for each one send an email via Resend (from `outreach@${process.env.SENDER_DOMAIN}`, to the lead's `email`, using `generated_subject` and `generated_body` as plain text or simple HTML), then update that lead with a parameterized `UPDATE`: set `initial_sent_at` to now, `initial_resend_id` to the id Resend returns, `status` to `'sent'`. If the Resend call throws, instead set `status` to `'failed'` and continue to the next lead rather than stopping. Return the number of emails successfully sent.

**Acceptance test:** run it manually against 2-3 real leads first (not the whole batch) and confirm they arrive, look right, and the `leads` table updates correctly.

---

## M7 — Follow-up logic

**Objective:** exactly one follow-up email per lead, sent 7+ days after the initial send, only once.

**What it needs to do:**
- Find leads where `status = 'sent'`, `initial_sent_at` is 7 or more days ago, and `followup_sent_at` is still null.
- Generate a short follow-up (references the first email lightly, doesn't repeat the whole pitch, even shorter than the original).
- Send it the same way as M6, respecting the same daily cap (follow-ups count toward the same cap, don't give them a separate budget).
- Update `followup_subject`, `followup_body`, `followup_sent_at`, `followup_resend_id`, set `status` to `'followed_up'`.

**AI prompt to paste:**
> Write a TypeScript function `sendFollowUps()` for a Next.js app using DeepSeek (for generating the follow-up text, same setup as the `generateEmail` function, including stripping markdown code fences before parsing its JSON response), Resend (same setup as `sendBatch`), and a Postgres connection pool (`pool` from `lib/db.ts`). It should: find leads where `status = 'sent'`, `initial_sent_at` is more than 7 days ago, and `followup_sent_at` is null. Respect the same daily cap logic as `sendBatch` (read `settings.daily_cap`, count today's combined initial + follow-up sends, only process up to the remaining amount). For each eligible lead, generate a short follow-up email (2-3 sentences, referencing that this is a quick follow-up to the earlier note, not repeating the full pitch, same style rules as before: no em dashes, no filler, sounds human) via DeepSeek returning JSON `{ "subject": string, "body": string }`, send it via Resend, then update the lead with a parameterized `UPDATE`: `followup_subject`, `followup_body`, `followup_sent_at` to now, `followup_resend_id`, `status` to `'followed_up'`. Handle failures per-lead without stopping the batch.

**Acceptance test:** manually backdate a test lead's `initial_sent_at` to 8 days ago (via Neon's SQL Editor), run the function, confirm the follow-up sends and the row updates correctly.

---

## M8 — Automation trigger (the daily runner)

**Objective:** one protected endpoint that runs the full loop, called automatically every day.

**What the endpoint should do, in order:**
1. Check a secret header matches `CRON_SECRET` — reject with 401 if not.
2. For each `niche` with `status = 'active'`: run discovery (M3) for it.
3. For all leads with `status = 'new'`: scrape (M4).
4. For all leads with `status = 'scraped'`: generate (M5).
5. Run `sendBatch()` (M6).
6. Run `sendFollowUps()` (M7).
7. Update `settings.last_run_at` to now.

**AI prompt to paste:**
> Write a Next.js App Router API route at `app/api/run-pipeline/route.ts` with a `GET` handler. It should first check that the request header `x-cron-secret` matches `process.env.CRON_SECRET`, returning a 401 response if not. Then, in order: fetch all niches with `status = 'active'` and call a `discoverBusinesses(label, city)` function for each; fetch all leads with `status = 'new'` and call `scrapeWebsite(id, website)` for each; fetch all leads with `status = 'scraped'` and call `generateEmail(id)` for each; call `sendBatch()`; call `sendFollowUps()`; then update the `settings` table's single row to set `last_run_at` to the current timestamp. Wrap each stage in a try/catch so one stage failing doesn't stop the others from running, and return a JSON summary of what happened at each stage (counts or error messages).

**Then set up the schedule** — create `.github/workflows/daily-run.yml` in your repo:
```yaml
name: Daily Outreach Run
on:
  schedule:
    - cron: '0 13 * * *'  # 13:00 UTC daily — adjust to your preferred time
  workflow_dispatch: {}     # lets you trigger it manually from GitHub's Actions tab too

jobs:
  run:
    runs-on: ubuntu-latest
    steps:
      - name: Call pipeline endpoint
        run: |
          curl -f -X GET "https://your-vercel-url.vercel.app/api/run-pipeline" \
            -H "x-cron-secret: ${{ secrets.CRON_SECRET }}"
```

Add `CRON_SECRET` to your GitHub repo's secrets (Settings → Secrets and variables → Actions → New repository secret) with the same value as in Vercel.

**Acceptance test:** trigger the workflow manually from GitHub's Actions tab (`workflow_dispatch`) and confirm the pipeline runs end to end without you touching anything else. Then leave the schedule alone for a day and check it fired on its own.

---

## M9 — Dashboard & Access Control

**Objective:** a secret-key protected dashboard where you can see leads, niches, and settings without opening the database directly or building login/passcode UI.

**What it needs:**
- Middleware access control: no login forms or passcode pages. If a request includes `?key=YOUR_APP_SECRET` matching `process.env.APP_SECRET`, set an `httpOnly` session cookie named `authed=true` so internal page navigation stays unlocked. If a request lacks both the secret key and valid cookie, return a 404 response.
- A leads table: business name, status, sent/opened timestamps, filterable by status.
- A niches view: list with status, and a way to manually add a new one.
- A settings panel: edit `daily_cap`, toggle `paused`.

**AI prompt to paste:**
> Create `middleware.ts` for a Next.js App Router app to protect all routes without any passcode page or login UI. Check if the URL query parameter `key` matches `process.env.APP_SECRET` or if an `authed` cookie exists with value `true`. If valid via `?key=`, set an `httpOnly` `authed=true` cookie on the response so sub-pages stay unlocked. If neither is valid, return a 404 response. Then write `app/page.tsx` as a Server Component dashboard that queries the Postgres pool (`pool` from `lib/db.ts`) directly: fetch and display all rows from the `leads` table (business_name, status, initial_sent_at, initial_opened_at, followup_sent_at) in a table, with a simple dropdown to filter by status. Add a section showing all `niches` rows with a form (posting to a small API route that runs a parameterized `INSERT`) to add a new one (label + city inputs, inserts into the niches table with status 'active' and source 'seed'). Add a settings section showing the current `daily_cap` and `paused` value from the settings table, with an input to change daily_cap and a toggle for paused, saving via another small API route that runs a parameterized `UPDATE`. Use Tailwind for basic styling, keep it functional and plain, no need for anything fancy.

**Acceptance test:** accessing `http://localhost:3000/` returns 404, accessing `http://localhost:3000/?key=YOUR_SECRET` grants access to the dashboard and sets the session cookie, and you can see real data from all three tables, change the daily cap, and toggle pause — and confirm pause actually stops `sendBatch()` on the next pipeline run.

---

## M10 — Open tracking

**Objective:** know when a sent email gets opened.

**What it needs:**
- A webhook endpoint that receives Resend's `email.opened` event.
- Match the event's message id against `initial_resend_id` or `followup_resend_id` on a lead, and set the corresponding `initial_opened_at` or `followup_opened_at`.
- Register that webhook URL in the Resend dashboard (Webhooks → Add Endpoint).

**AI prompt to paste:**
> Write a Next.js App Router API route at `app/api/webhooks/resend/route.ts` with a `POST` handler that receives Resend webhook events, using the Postgres pool (`pool` from `lib/db.ts`). Parse the JSON body; if `type` is `"email.opened"`, get the `data.email_id` field, then run a parameterized `UPDATE` against the `leads` table for a row where `initial_resend_id` equals that id (set `initial_opened_at` to the current timestamp) or where `followup_resend_id` equals that id (set `followup_opened_at` to the current timestamp). Return a 200 response regardless so Resend doesn't retry. Include basic error handling so a malformed payload doesn't crash the route.

Then in Resend dashboard: Webhooks → Add Endpoint → paste your deployed `/api/webhooks/resend` URL → subscribe to the `email.opened` event.

**Acceptance test:** send yourself a test email through the pipeline, open it from a different device/browser, and confirm `initial_opened_at` populates within a minute or two.

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
- Add a simple failure alert: if `/api/run-pipeline` catches an error in any stage, send yourself a plain email via Resend summarizing what failed (reuse the same Resend setup, send to your own address).
- Double check every external call (Places, AI API, Resend, website scraping) has a timeout and a try/catch — nothing should be able to hang the whole batch indefinitely.
- Review the full dashboard against real data for a few days: are statuses accurate, are timestamps right, does pause actually pause.
- Re-read a fresh batch of 15-20 generated emails after a week of real-world use — tone can drift once it's running on new niches it suggested itself; tighten the M5 prompt again if needed.

**Acceptance test:** the pipeline runs unattended for 7 days, you get notified the one time something breaks (test this by intentionally breaking one API key temporarily), and the dashboard reflects reality throughout.