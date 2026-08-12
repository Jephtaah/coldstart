const STAT_CARDS = [
  {
    accent: 'bg-[#141413]',
    label: 'Total Prospect Pool',
    value: '1,284',
    badge: { text: 'Active DB', bg: 'bg-[#ecfdf5]', fg: 'text-[#047857]', border: 'border-[rgba(167,243,208,.6)]' },
  },
  {
    accent: 'bg-[#d97706]',
    label: 'Sent Today / Cap',
    value: '34',
    valueSuffix: '/ 50',
    progress: { pct: 68, color: 'bg-[#d97706]' },
  },
  {
    accent: 'bg-[#2563eb]',
    label: 'Total Dispatched',
    value: '612',
    meta: 'emails delivered',
  },
  {
    accent: 'bg-[#059669]',
    label: 'Open Engagement Rate',
    value: '41.2%',
    badge: { text: '252 opened', bg: 'bg-[#ecfdf5]', fg: 'text-[#065f46]', border: 'border-[rgba(167,243,208,.6)]' },
  },
]

const STATUS_CHIPS = [
  { label: 'all', count: 1284, active: true },
  { label: 'new', count: 402 },
  { label: 'scraped', count: 311 },
  { label: 'generated', count: 148 },
  { label: 'sent', count: 289 },
  { label: 'followed up', count: 87 },
  { label: 'no website', count: 31 },
  { label: 'failed', count: 16 },
]

const STATUS_STYLES: Record<string, { bg: string; fg: string; border: string; dot: string }> = {
  sent: { bg: 'bg-[#ecfdf5]', fg: 'text-[#065f46]', border: 'border-[#a7f3d0]', dot: 'bg-[#059669]' },
  'followed up': { bg: 'bg-[#ecfdf5]', fg: 'text-[#065f46]', border: 'border-[#a7f3d0]', dot: 'bg-[#059669]' },
  failed: { bg: 'bg-[#fff1f2]', fg: 'text-[#9f1239]', border: 'border-[#fecdd3]', dot: 'bg-[#e11d48]' },
  'no website': { bg: 'bg-[#fff7ed]', fg: 'text-[#9a3412]', border: 'border-[#fed7aa]', dot: 'bg-[#ea580c]' },
  generated: { bg: 'bg-[#f0f9ff]', fg: 'text-[#075985]', border: 'border-[#bae6fd]', dot: 'bg-[#0284c7]' },
  scraped: { bg: 'bg-[#f0f9ff]', fg: 'text-[#075985]', border: 'border-[#bae6fd]', dot: 'bg-[#0284c7]' },
  new: { bg: 'bg-[#F0F0EC]', fg: 'text-[#595955]', border: 'border-[#D9D9D3]', dot: 'bg-[#8C8C85]' },
}

function seoStyle(score: number) {
  if (score <= 40) {
    return { label: `${score} · Weak`, bg: 'bg-[#fff1f2]', fg: 'text-[#9f1239]', border: 'border-[#fecdd3]', dot: 'bg-[#e11d48]' }
  }
  if (score <= 70) {
    return { label: `${score} · Fair`, bg: 'bg-[#fffbeb]', fg: 'text-[#92400e]', border: 'border-[#fde68a]', dot: 'bg-[#d97706]' }
  }
  return { label: `${score} · Solid`, bg: 'bg-[#ecfdf5]', fg: 'text-[#065f46]', border: 'border-[#a7f3d0]', dot: 'bg-[#059669]' }
}

const LEADS = [
  { name: 'Lone Star Garage Doors', address: '4821 Ross Ave, Dallas, TX 75204', status: 'sent', seo: 18, website: 'lonestargaragetx.com', email: 'info@lonestargaragetx.com', sent: '3/14/26, 09:12', opened: true },
  { name: 'Sunbelt Roofing Co', address: '1190 W Oltorf St, Austin, TX 78704', status: 'sent', seo: 24, website: 'sunbeltroofing.net', email: 'office@sunbeltroofing.net', sent: '3/14/26, 09:14', opened: false },
  { name: 'Cypress Chiropractic', address: '7702 SW 88th St, Miami, FL 33156', status: 'generated', seo: 31, website: 'cypresschiro.com', email: 'front.desk@cypresschiro.com', sent: '—', opened: false },
  { name: 'Ironwood Plumbing', address: '3345 Kirby Dr, Houston, TX 77098', status: 'followed up', seo: 37, website: 'ironwoodplumbing.com', email: 'dispatch@ironwoodplumbing.com', sent: '3/07/26, 08:55', opened: true },
  { name: 'Valley Pest Solutions', address: '2201 E Camelback Rd, Phoenix, AZ 85016', status: 'no website', seo: 52, website: '—', email: 'valleypestaz@gmail.com', sent: '—', opened: false },
  { name: 'Peachtree Landscaping', address: '918 Howell Mill Rd, Atlanta, GA 30318', status: 'scraped', seo: 44, website: 'peachtreelandscape.co', email: 'hello@peachtreelandscape.co', sent: '—', opened: false },
]

export default function DashboardPreview() {
  return (
    <div aria-hidden="true" className="pointer-events-none bg-[#F8F8F5] text-[#141413]">
      <header className="border-b border-[#E6E6DF] bg-white/80 px-6 py-4">
        <div className="max-w-[1280px] mx-auto flex justify-between items-center gap-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-[#141413] text-white flex items-center justify-center font-mono font-bold text-sm tracking-tighter shadow-sm shrink-0">
              CS
            </div>
            <h1 className="text-base font-semibold tracking-tight">ColdStart Operator</h1>
          </div>
          <div className="flex items-center gap-4 bg-[#F2F2EE] px-3.5 py-1.5 rounded-full border border-[#E0E0D8]">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-[#10b981] shadow-[0_0_8px_rgba(16,185,129,0.5)] shrink-0" />
              <span className="text-xs font-medium uppercase tracking-wide text-[#383833] whitespace-nowrap">
                Pipeline Running
              </span>
            </div>
            <span className="text-[#D0D0C8]">|</span>
            <span className="text-xs text-[#6B6B65] font-mono whitespace-nowrap">Sync: 13:04</span>
          </div>
        </div>
      </header>

      <main className="max-w-[1280px] mx-auto px-6 py-8 flex flex-col gap-8">
        <div className="grid grid-cols-4 gap-4">
          {STAT_CARDS.map((card) => (
            <div
              key={card.label}
              className="bg-white p-5 rounded-xl border border-[#E6E6DF] shadow-[0_1px_3px_rgba(0,0,0,0.02)] relative overflow-hidden"
            >
              <div className={`absolute top-0 left-0 right-0 h-0.5 ${card.accent}`} />
              <p className="text-[11px] font-mono uppercase tracking-wider text-[#71716B]">{card.label}</p>
              <div className="flex items-baseline justify-between mt-2">
                <span className="text-3xl font-semibold tracking-tight font-mono">
                  {card.value}
                  {card.valueSuffix && (
                    <span className="text-sm text-[#8C8C85] font-normal"> {card.valueSuffix}</span>
                  )}
                </span>
                {card.badge && (
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${card.badge.bg} ${card.badge.fg} ${card.badge.border}`}>
                    {card.badge.text}
                  </span>
                )}
                {card.progress && (
                  <div className="w-16 bg-[#EFEFED] h-2 rounded-full overflow-hidden border border-[#D9D9D3]">
                    <div className={`h-full rounded-full ${card.progress.color}`} style={{ width: `${card.progress.pct}%` }} />
                  </div>
                )}
                {card.meta && <span className="text-xs font-mono text-[#6B6B65]">{card.meta}</span>}
              </div>
            </div>
          ))}
        </div>

        <div className="border-b border-[#E6E6DF]">
          <nav className="-mb-px flex gap-8 overflow-x-auto">
            <button className="py-3.5 px-1 border-0 border-b-2 border-[#141413] bg-transparent font-medium text-sm text-[#141413] flex items-center gap-2 whitespace-nowrap">
              <span>Leads Directory</span>
              <span className="text-xs font-mono px-2 py-0.5 rounded-full bg-[#EFEFED] text-[#595955] border border-[#D9D9D3]">1284</span>
            </button>
            <button className="py-3.5 px-1 border-0 border-b-2 border-transparent bg-transparent font-medium text-sm text-[#71716B] flex items-center gap-2 whitespace-nowrap">
              <span>Targeting Matrix</span>
              <span className="text-xs font-mono px-2 py-0.5 rounded-full bg-[#EFEFED] text-[#595955] border border-[#D9D9D3]">27</span>
            </button>
            <button className="py-3.5 px-1 border-0 border-b-2 border-transparent bg-transparent font-medium text-sm text-[#71716B] whitespace-nowrap">
              Pipeline Settings
            </button>
            <button className="py-3.5 px-1 border-0 border-b-2 border-transparent bg-transparent font-medium text-sm text-[#71716B] flex items-center gap-2 whitespace-nowrap">
              <span>Error Log</span>
              <span className="text-xs font-mono px-2 py-0.5 rounded-full bg-[#EFEFED] text-[#595955] border border-[#D9D9D3]">6</span>
            </button>
          </nav>
        </div>

        <div className="bg-white rounded-xl border border-[#E6E6DF] shadow-[0_1px_3px_rgba(0,0,0,0.02)] overflow-hidden">
          <div className="p-5 border-b border-[#E6E6DF]">
            <h2 className="text-base font-semibold tracking-tight">Leads Directory</h2>
            <p className="text-sm text-[#71716B] leading-snug mt-0.5">
              Every business the pipeline has discovered, scored, and (where eligible) emailed. SEO score is
              0-100 (lower = weaker site = higher outreach priority); leads scoring 65+ are dropped
              automatically before generation. Status moves{' '}
              <span className="font-mono text-xs">new → scraped → generated → sent → followed_up</span>, or{' '}
              <span className="font-mono text-xs">no_website</span> / <span className="font-mono text-xs">failed</span>{' '}
              when the pipeline can&apos;t proceed. Click a row to read the generated email.
            </p>
          </div>

          <div className="p-5 border-b border-[#E6E6DF] bg-[#FAFAF7] flex justify-between items-center gap-4">
            <div className="flex flex-nowrap items-center gap-1.5 overflow-x-auto">
              {STATUS_CHIPS.map((chip) => (
                <button
                  key={chip.label}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium capitalize flex items-center gap-1.5 whitespace-nowrap border ${
                    chip.active
                      ? 'bg-[#141413] text-white border-[#141413]'
                      : 'bg-white text-[#595955] border-[#E0E0D8]'
                  }`}
                >
                  {chip.label}
                  <span
                    className={`px-1.5 py-0.5 rounded-full text-[10px] font-mono leading-none border ${
                      chip.active
                        ? 'bg-white/15 text-white border-transparent'
                        : 'bg-[#EFEFED] text-[#595955] border-[#D9D9D3]'
                    }`}
                  >
                    {chip.count}
                  </span>
                </button>
              ))}
            </div>
            <input
              type="text"
              readOnly
              placeholder="Filter by business, email, website..."
              className="w-72 shrink-0 px-3.5 py-2 text-sm bg-white border border-[#D9D9D3] rounded-lg outline-none text-[#141413]"
            />
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm border-collapse">
              <thead className="bg-[#F5F5F0] border-b border-[#E6E6DF] text-[#6B6B65] font-mono text-xs uppercase tracking-wide">
                <tr>
                  <th className="px-6 py-3.5 font-medium w-[30%]">Business / Location</th>
                  <th className="px-6 py-3.5 font-medium w-[11%]">Pipeline Status</th>
                  <th className="px-6 py-3.5 font-medium w-[10%]">SEO Weakness</th>
                  <th className="px-6 py-3.5 font-medium w-[17%]">Website</th>
                  <th className="px-6 py-3.5 font-medium w-[22%]">Email Address</th>
                  <th className="px-6 py-3.5 font-medium w-[11%]">Sent Timestamp</th>
                  <th className="px-6 py-3.5 font-medium w-[5%]">Engagement</th>
                  <th className="px-6 py-3.5 font-medium w-[5%]" />
                </tr>
              </thead>
              <tbody>
                {LEADS.map((lead) => {
                  const status = STATUS_STYLES[lead.status]
                  const seo = seoStyle(lead.seo)
                  return (
                    <tr key={lead.name} className="border-t border-[#EFEFED]">
                      <td className="px-6 py-4">
                        <div className="font-medium text-[#141413]">{lead.name}</div>
                        <div className="text-xs text-[#71716B] mt-0.5">{lead.address}</div>
                      </td>
                      <td className="px-6 py-4">
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium capitalize border ${status.bg} ${status.fg} ${status.border}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${status.dot}`} />
                          {lead.status}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium whitespace-nowrap border ${seo.bg} ${seo.fg} ${seo.border}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${seo.dot}`} />
                          {seo.label}
                        </span>
                      </td>
                      <td className="px-6 py-4 font-mono text-xs text-[#595955]">
                        <span className="text-[#2563eb]">{lead.website}</span>
                      </td>
                      <td className="px-6 py-4 font-mono text-xs text-[#383833]">{lead.email}</td>
                      <td className="px-6 py-4 font-mono text-xs text-[#71716B]">{lead.sent}</td>
                      <td className="px-6 py-4">
                        {lead.opened && (
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-[#047857] bg-[#ecfdf5] px-2 py-0.5 rounded border border-[#a7f3d0]">
                            <span className="w-1.5 h-1.5 rounded-full bg-[#059669]" />
                            Opened
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        <button className="inline-flex items-center gap-1 text-xs font-semibold whitespace-nowrap text-white bg-[#2563eb] border-0 px-3 py-1.5 rounded-lg shadow-[0_1px_2px_rgba(0,0,0,.05)]">
                          View Email
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between gap-3 px-6 py-3 border-t border-[#E6E6DF] bg-[#FAFAF7]">
            <div className="text-xs text-[#6B6B65] font-mono">Showing 1–6 of 1284</div>
            <div className="flex items-center gap-3">
              <select className="px-2 py-1.5 text-xs bg-white border border-[#D9D9D3] rounded-md text-[#141413]" disabled>
                <option>25 / page</option>
              </select>
              <div className="flex items-center gap-1">
                <button className="px-2.5 py-1.5 text-xs font-medium rounded-md border border-[#D9D9D3] bg-white text-[#383833] opacity-40">
                  Prev
                </button>
                <button className="px-2.5 py-1.5 text-xs font-medium rounded-md border-0 bg-[#141413] text-white">1</button>
                <button className="px-2.5 py-1.5 text-xs font-medium rounded-md border border-[#D9D9D3] bg-white text-[#383833]">2</button>
                <button className="px-2.5 py-1.5 text-xs font-medium rounded-md border border-[#D9D9D3] bg-white text-[#383833]">3</button>
                <span className="px-1 text-xs text-[#A3A39E]">…</span>
                <button className="px-2.5 py-1.5 text-xs font-medium rounded-md border border-[#D9D9D3] bg-white text-[#383833]">52</button>
                <button className="px-2.5 py-1.5 text-xs font-medium rounded-md border border-[#D9D9D3] bg-white text-[#383833]">Next</button>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
