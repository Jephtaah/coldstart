# Cold Outreach Automation — PRD

## 1. Problem

Jephtah runs cold email outreach for his dev agency (garage door repair, chiropractic, and other local-business niches) entirely by hand: finding businesses, checking their site, writing a personalized email, sending it. This doesn't scale and eats time that should go into client work.

## 2. Goal

A single-user, always-running pipeline that:
1. Finds businesses in a target niche/city
2. Pulls their site content
3. Generates a personalized, human-sounding cold email
4. Sends it automatically, within safe daily limits
5. Sends one automatic follow-up after 7 days if nothing else happened
6. Logs everything, and expands into new niches on its own once a niche is exhausted

No manual review step in the loop. Jephtah checks in on a dashboard when he wants to, not because the app needs him to.

## 3. Non-goals (v1)

- No multi-user auth / login system (single operator, lightweight passcode gate only)
- No reply detection or inbox parsing (replies go to his normal inbox, untouched)
- No opt-out/unsubscribe handling (deliberately left out — see decisions below)
- No CRM-style deal tracking / pipeline stages
- No A/B testing or advanced analytics — just send/open logs

## 4. Core decisions

| Decision | Answer |
|---|---|
| Access control | No real auth. Single shared passcode gate in front of the dashboard (env var, one cookie). Not a login system — just a lock on the door, since the app lives on a public URL. |
| Send mode | Fully autonomous send, no per-email approval. Guardrails instead of a human checkpoint. |
| Niche targeting | Fixed seed list to start; the app proposes and adds new niches/cities on its own once a niche's leads are exhausted. |
| Email sending | Resend, free tier (3,000/mo, 100/day), against a newly purchased domain (~$10-12/yr). Gmail/no-domain sending rejected — sandbox restrictions and personal-account ban risk. |
| Open tracking | Included — Resend's pixel + webhook. |
| Reply tracking | Not built. Replies just show up in his normal inbox. |
| Follow-up | One automatic follow-up email, 7 days after the first, sent regardless of whether they replied (no reply detection to check against). |
| Opt-out language | Deliberately omitted. Note: CAN-SPAM technically covers one-time commercial outreach too (real sender identity, physical address, some opt-out path) — not just newsletters. Not legal advice, and enforcement risk for this scale is low, but it's a conscious tradeoff being made, not an oversight. |
| Blocklist | Not built — no opt-out mechanism means nothing to check against. Dedup (never email the same business twice) is kept regardless, since that's just avoiding wasted/duplicate sends, unrelated to compliance. |
| AI provider | DeepSeek (OpenAI-compatible API) for scrape-summarization and email generation, behind one swappable function so another provider can be dropped in later. |
| Business discovery | Google Places API (Text Search — New). Has a real per-call cost, offset by Google's monthly free credit at this volume — the one line item worth watching in Google Cloud billing. |
| Automation trigger | A scheduled job (GitHub Actions, free) calls one protected URL on your app daily. No server needs to run 24/7. |

## 5. Guardrails (v1)

- **Daily send cap**: configurable, starts low (e.g. 20-30/day), hard-capped under Resend's 100/day free ceiling.
- **Dedup**: never contact the same business twice (checked by domain + place_id before every send).
- **Follow-up cap**: exactly one follow-up per lead, only once, only 7+ days after the first send.
- **Pause switch**: one flag in settings that halts all sending immediately.
- **Style guardrail**: the AI prompt enforces Jephtah's known preferences (no em dashes, no corporate filler, no template-triplet phrasing, one honest specific detail as the opener, no generic "I noticed your website..." lines) — tuned against real output in the build phase, not assumed correct on the first try.

## 6. Architecture (high level)

- **Frontend/dashboard**: Next.js (App Router, TypeScript, Tailwind) — a simple internal tool, passcode-gated.
- **Database**: Neon (serverless Postgres) — 3 tables: `niches`, `leads`, `settings`. Plain `pg` for queries, no ORM, no vendor-specific client — Neon is being used purely as hosted Postgres.
- **Scraping**: server-side fetch + text extraction from the business's own website (homepage + about/contact if linked).
- **AI generation**: DeepSeek API call, one function boundary so the provider can be swapped later.
- **Sending**: Resend API, domain verified, tracking enabled.
- **Automation trigger**: GitHub Actions cron calling a protected endpoint on a schedule.
- **Webhook**: one endpoint to receive Resend's open-tracking events and write them to the DB.

## 7. Data model

- **`niches`** — id, label, city, status (`active` / `exhausted`), source (`seed` / `ai_suggested`), reasoning (nullable, filled when AI-suggested), created_at
- **`leads`** — id, niche_id, business_name, address, website, email, place_id, status (`new` / `scraped` / `generated` / `sent` / `followed_up` / `failed`), scraped_content, generated_subject, generated_body, initial_sent_at, initial_opened_at, initial_resend_id, followup_subject, followup_body, followup_sent_at, followup_opened_at, followup_resend_id, created_at
- **`settings`** — single row: daily_cap, paused (bool), last_run_at

No separate email-log or opt-out tables — everything about a lead's email history lives on the lead row itself, since each lead gets at most two emails.

## 8. Open items to revisit later (not blocking v1)

- Whether to eventually add reply detection if manually checking the inbox becomes annoying
- Whether to move off Resend free tier if volume grows past 100/day
- Whether niche auto-expansion needs a sanity check after a few weeks of real suggestions
- Whether to reconsider the opt-out omission if a business ever asks to stop and there's no clean way to log it beyond memory

See the separate **Milestones & Build Guide** document for the actual step-by-step implementation plan.