export const DEFAULT_INDUSTRIES = [
  'Garage Door Repair',
  'Chiropractor',
  'Roofing Contractor',
  'Plumbing',
  'HVAC',
  'Electrician',
  'Landscaping',
  'Pest Control',
  'House Cleaning',
]

export const DEFAULT_CITIES = [
  'Dallas, TX',
  'Austin, TX',
  'Miami, FL',
  'Houston, TX',
  'Phoenix, AZ',
  'Atlanta, GA',
  'Denver, CO',
  'Charlotte, NC',
  'Seattle, WA',
]

export const MAX_PLACES_PAGES_PER_NICHE = 3
export const PLACES_PAGES_TO_SKIP = 0
export const MAX_PLACES_CALLS_PER_DAY = 100
export const MAX_SEO_SCORE_TO_SEND = 75
export const MAX_INITIAL_SENDS_PER_DAY = 50
export const MAX_FOLLOWUPS_PER_DAY = 50
export const MAX_SENDS_PER_RUN = 50
export const MAX_FOLLOWUPS_PER_RUN = 2
export const SEND_INTERVAL_MS_MIN = 20000
export const SEND_INTERVAL_MS_MAX = 40000
export const MAX_DAILY_CAP = 100
export const MAX_EMAIL_SEARCHES_PER_RUN = 4
export const MAX_EMAIL_SEARCH_RESULTS = 4

// Per-run stage bounds so a single Vercel function invocation stays inside the
// platform timeout. Kept here, not scattered across route files.
export const MAX_NICHES_PER_RUN = 20
export const MAX_SCRAPES_PER_RUN = 12
export const MAX_GENERATES_PER_RUN = 8

// Timeouts for every external network call (abort the request, never hang the
// batch). Also centralized so each integration is uniformly bounded.
export const PLACES_TIMEOUT_MS = 10000
export const SCRAPE_TIMEOUT_MS = 10000
export const AI_TIMEOUT_MS = 15000
export const RESEND_TIMEOUT_MS = 10000

// Soft wall-clock budget for a single automation invocation, leaving margin
// under Vercel's 60s serverless max duration on the Hobby plan. Stages stop
// starting new work once it is spent (a late in-flight call may still finish,
// but nothing new begins after this point).
export const RUN_BUDGET_MS = 45000

// Same budget for the discovery route, which can now touch many niches per run
// (each one paginating Google Places). Without a cap, a large active-niche set
// would push a single invocation past the function timeout.
export const DISCOVER_BUDGET_MS = 45000

// Delay between Places page fetches to stay polite to Google.
export const PLACES_PAGE_DELAY_MS = 300

// A follow-up only goes out once this much time has passed since the initial send.
export const FOLLOWUP_DELAY_INTERVAL = '7 days'

// AI model configuration shared by generation, follow-ups, and niche expansion.
export const DEEPSEEK_API_URL = 'https://api.deepseek.com/chat/completions'
export const DEEPSEEK_MODEL = 'deepseek-v4-flash'
export const DEEPSEEK_TEMPERATURE = 0.7
export const MAX_AI_ATTEMPTS = 2
// Alert thresholds for send-health monitoring (rolling 24h window).
export const BOUNCE_ALERT_THRESHOLD = 5
export const COMPLAINT_ALERT_THRESHOLD = 1
