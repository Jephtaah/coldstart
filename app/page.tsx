import Link from 'next/link'
import DashboardPreview from '@/components/DashboardPreview'

const GITHUB_URL = 'https://github.com/Jephtaah/ColdStart'

const PIPELINE_STEPS = [
  {
    title: 'Discovery',
    body: 'Google Places sweeps every active industry and city pair, paginating past the businesses already winning page one. It runs on its own endpoint and its own daily call budget, so a Places outage never stalls the rest.',
  },
  {
    title: 'SEO scoring',
    body: 'Each lead gets a 0–100 weakness score from search position, reviews, rating and on-page signals. Anything already ranking well is suppressed before it reaches generation.',
  },
  {
    title: 'Scraping',
    body: 'The site is fetched and mined for a contact address. Businesses with no website get an email search instead. Leads with no discoverable email are dropped and never re-added.',
  },
  {
    title: 'Generation',
    body: 'A model writes the subject and body under strict rules: one specific detail from their own site as the opener, three to five sentences, no corporate filler.',
  },
  {
    title: 'Sending',
    body: 'Emails go out via Resend, weakest sites first, inside a daily cap, with exactly one follow-up seven days later. Opens, bounces and complaints feed straight back into suppression.',
  },
]

const STACK = [
  'Next.js 16, App Router, TypeScript, Tailwind CSS v4',
  'Neon serverless Postgres via plain pg, no ORM',
  'Google Places API (New)',
  'DeepSeek API for generation and niche expansion',
  'Resend, with an engagement webhook',
  'GitHub Actions daily cron, deployed on Vercel',
]

const EXAMPLE_EMAIL = {
  to: 'dispatch@ironwoodplumbing.com',
  status: 'Opened · 09:41',
  subject: 'your third page on Google',
  body: `Saw the 2018 kitchen remodel gallery on ironwoodplumbing.com — the before and after shots are better than anything on page one for "plumber Houston".

The site is what's holding it back: no meta description, no mobile viewport tag, and the homepage takes about six seconds to load on a phone. That's most of the gap between you and the shops above you.

I build sites for trades businesses and fix exactly this. Worth fifteen minutes?`,
}

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-[#F8F8F5] text-[#141413]">
      <header className="flex justify-between items-center gap-3 py-6 px-5 sm:px-10 lg:px-20">
        <span className="font-serif text-xl">ColdStart</span>
        <div className="flex items-center gap-5 text-[13px] text-[#4A4A45]">
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="transition-colors duration-150 hover:underline focus:outline-none focus:ring-2 focus:ring-[#141413]/20 rounded-sm"
          >
            Repository
          </a>
          <Link
            href="/login"
            className="px-[15px] py-[7px] text-xs rounded-full border border-[#D9D9D3] bg-white transition-colors duration-150 hover:bg-[#F0F0EC] focus:outline-none focus:ring-2 focus:ring-[#141413]/20"
          >
            Operator login
          </Link>
        </div>
      </header>

      <main className="flex flex-col">
        <section className="px-5 sm:px-10 lg:px-20 pt-14 sm:pt-18 lg:pt-[110px] pb-14 lg:pb-[90px] max-w-[900px] mx-auto text-center flex flex-col items-center">
          <div className="inline-flex items-center gap-2 px-3.5 py-[5px] rounded-full bg-white border border-[#E6E6DF] text-xs text-[#4A4A45] mb-9">
            <span className="w-1.5 h-1.5 rounded-full bg-[oklch(0.5_0.09_160)]" />
            Runs itself daily, no review step
          </div>
          <h1 className="font-serif text-[38px] sm:text-[52px] lg:text-[82px] leading-[1.02] tracking-[-0.02em] [text-wrap:balance] mb-6">
            An outreach pipeline you leave alone.
          </h1>
          <p className="max-w-[60ch] text-base leading-[1.8] text-[#4A4A45] [text-wrap:pretty]">
            Find local businesses ranking weak on Google. Score their site. Find the email. Write
            the pitch. Send it, follow up once, log everything. ColdStart does the whole loop on a
            cron and leaves you a dashboard to read.
          </p>
          <div className="flex flex-wrap gap-3 justify-center mt-10">
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="px-[26px] py-[13px] rounded-full text-sm font-medium text-[#F8F8F5] bg-[oklch(0.42_0.08_160)] transition-colors duration-150 hover:bg-[oklch(0.36_0.08_160)] focus:outline-none focus:ring-2 focus:ring-[#141413]/20"
            >
              Get the code
            </a>
            <a
              href={`${GITHUB_URL}#readme`}
              target="_blank"
              rel="noopener noreferrer"
              className="px-[26px] py-[13px] rounded-full text-sm font-medium text-[#141413] border border-[#D9D9D3] bg-white transition-colors duration-150 hover:bg-[#F0F0EC] focus:outline-none focus:ring-2 focus:ring-[#141413]/20"
            >
              Read the build guide
            </a>
          </div>
        </section>

        <section className="px-5 sm:px-10 lg:px-20 pb-14 lg:pb-[90px]">
          <div className="relative border border-[#E6E6DF] rounded-2xl overflow-hidden bg-white shadow-[0_24px_60px_-30px_rgba(20,20,19,0.28)] h-[260px] sm:h-[380px] lg:h-[540px]">
            <span className="sr-only">Screenshot of the ColdStart operator dashboard</span>
            <div
              className="w-[1440px] h-[1400px] origin-top-left scale-[0.18] sm:scale-[0.264] lg:scale-[0.6389]"
              aria-hidden="true"
            >
              <DashboardPreview />
            </div>
          </div>
        </section>

        <section className="px-5 sm:px-10 lg:px-20 pb-14 lg:pb-24 max-w-[920px] mx-auto w-full">
          <h2 className="font-serif text-[28px] sm:text-[34px] lg:text-[40px] text-center mb-2">
            How it works
          </h2>
          <p className="text-sm text-[#8C8C85] text-center mb-10 lg:mb-[52px]">
            Five stages, each one bounded so a single run always finishes.
          </p>
          <ol className="flex flex-col">
            {PIPELINE_STEPS.map((step, i) => (
              <li key={step.title} className="grid grid-cols-[38px_1fr] sm:grid-cols-[64px_1fr] gap-[28px] mb-[38px] last:mb-0">
                <div className="w-[38px] h-[38px] rounded-full border border-[oklch(0.5_0.09_160_/_0.35)] text-[oklch(0.42_0.08_160)] flex items-center justify-center font-mono text-[13px]">
                  {i + 1}
                </div>
                <div>
                  <h3 className="text-base font-semibold tracking-[-0.01em] mb-[7px]">{step.title}</h3>
                  <p className="text-sm leading-[1.8] text-[#4A4A45] [text-wrap:pretty]">{step.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section className="px-5 sm:px-10 lg:px-20 pb-14 lg:pb-24 max-w-[920px] mx-auto w-full">
          <h2 className="font-serif text-[28px] sm:text-[34px] lg:text-[40px] text-center mb-2">
            What it writes
          </h2>
          <p className="text-sm text-[#8C8C85] text-center mb-10">
            One real detail from their site, three to five sentences, nothing else.
          </p>
          <div className="bg-white border border-[#E6E6DF] rounded-2xl px-6 sm:px-10 py-[34px] shadow-[0_1px_3px_rgba(0,0,0,0.02)]">
            <div className="flex justify-between text-xs text-[#8C8C85] pb-[18px] border-b border-[#EFEFED] mb-[22px]">
              <span>{EXAMPLE_EMAIL.to}</span>
              <span className="text-[oklch(0.42_0.08_160)]">{EXAMPLE_EMAIL.status}</span>
            </div>
            <div className="font-serif text-2xl sm:text-[26px] mb-4">{EXAMPLE_EMAIL.subject}</div>
            <p className="text-[15px] leading-[1.85] text-[#383833] whitespace-pre-line [text-wrap:pretty]">
              {EXAMPLE_EMAIL.body}
            </p>
          </div>
        </section>

        <section className="px-5 sm:px-10 lg:px-20 pb-14 lg:pb-24 max-w-[920px] mx-auto w-full grid grid-cols-1 md:grid-cols-2 gap-16">
          <div>
            <h2 className="font-serif text-2xl sm:text-[30px] mb-[22px]">Built on</h2>
            {STACK.map((item) => (
              <div key={item} className="text-sm text-[#383833] leading-relaxed py-[9px] border-b border-[#EFEFED]">
                {item}
              </div>
            ))}
          </div>
          <div>
            <h2 className="font-serif text-2xl sm:text-[30px] mb-[22px]">Run your own</h2>
            <p className="text-sm leading-[1.8] text-[#4A4A45] mb-[18px]">
              Bring a Neon database, a Google Places key, a DeepSeek key and a verified Resend
              domain, set the environment variables from the README, and the daily GitHub Action
              takes it from there.
            </p>
            <pre className="bg-[#141413] text-[#F8F8F5] rounded-[10px] font-mono text-xs leading-[1.9] px-5 py-[18px] overflow-x-auto">
{`git clone github.com/Jephtaah/ColdStart.git
cd ColdStart
npm install
npm run dev`}
            </pre>
          </div>
        </section>
      </main>

      <footer className="border-t border-[#E6E6DF] py-7 px-5 sm:px-10 lg:px-20 text-center text-xs text-[#8C8C85]">
        ColdStart is open source under MIT.{' '}
        <a
          href={GITHUB_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="underline transition-colors duration-150 hover:text-[#4A4A45] focus:outline-none focus:ring-2 focus:ring-[#141413]/20 rounded-sm"
        >
          github.com/Jephtaah/ColdStart
        </a>
      </footer>
    </div>
  )
}
