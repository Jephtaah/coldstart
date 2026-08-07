'use client'

import React, { useState, useEffect, useRef, useSyncExternalStore } from 'react'
import { useRouter } from 'next/navigation'

interface Lead {
  id: string
  business_name: string
  address: string | null
  website: string | null
  email: string | null
  status: string
  seo_score: number | null
  seo_flags: string | null
  generated_subject: string | null
  generated_body: string | null
  followup_subject: string | null
  followup_body: string | null
  initial_sent_at: string | null
  initial_opened_at: string | null
  followup_sent_at: string | null
  followup_opened_at: string | null
  created_at: string
}

interface Niche {
  id: string
  label: string
  city: string
  status: string
  source: string
  reasoning: string | null
  created_at: string
}

interface Settings {
  daily_cap: number
  paused: boolean
  last_run_at: string | null
}

interface Stats {
  total: number
  sent_total: number
  opened_total: number
  sent_today: number
}

interface DashboardClientProps {
  initialSettings: Settings
  initialNiches: Niche[]
  initialLeads: Lead[]
  stats: Stats
  statusCounts: Record<string, number>
  defaultIndustries: string[]
  defaultCities: string[]
}

const LEAD_STATUS_TABS = ['all', 'new', 'scraped', 'generated', 'sent', 'followed_up', 'no_website', 'failed'] as const
const PAGE_SIZE_OPTIONS = [10, 25, 50]

interface PaginationControlsProps {
  page: number
  pageSize: number
  total: number
  onPageChange: (page: number) => void
  onPageSizeChange: (size: number) => void
}

function PaginationControls({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
}: PaginationControlsProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1
  const end = Math.min(page * pageSize, total)
  const pageNumbers: number[] = []
  const window = 2
  for (let p = 1; p <= totalPages; p++) {
    if (p === 1 || p === totalPages || (p >= page - window && p <= page + window)) {
      pageNumbers.push(p)
    } else if (pageNumbers[pageNumbers.length - 1] !== -1) {
      pageNumbers.push(-1)
    }
  }

  return (
    <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-6 py-3 border-t border-[#E6E6DF] bg-[#FAFAF7]">
      <div className="text-xs text-[#6B6B65] font-mono">
        {total === 0 ? '0 results' : `Showing ${start}\u2013${end} of ${total}`}
      </div>
      <div className="flex items-center gap-3">
        <select
          value={pageSize}
          onChange={(e) => onPageSizeChange(parseInt(e.target.value, 10))}
          className="px-2 py-1.5 text-xs bg-white border border-[#D9D9D3] rounded-md focus:outline-none focus:ring-2 focus:ring-[#141413]/20"
          aria-label="Rows per page"
        >
          {PAGE_SIZE_OPTIONS.map((size) => (
            <option key={size} value={size}>
              {size} / page
            </option>
          ))}
        </select>
        <div className="flex items-center gap-1">
          <button
            onClick={() => onPageChange(page - 1)}
            disabled={page <= 1}
            className="px-2.5 py-1.5 text-xs font-medium rounded-md border border-[#D9D9D3] bg-white text-[#383833] disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[#F0F0EC] transition-colors"
            aria-label="Previous page"
          >
            Prev
          </button>
          {pageNumbers.map((p, index) =>
            p === -1 ? (
              <span key={`ellipsis-${index}`} className="px-1 text-xs text-[#A3A39E]">
                …
              </span>
            ) : (
              <button
                key={p}
                onClick={() => onPageChange(p)}
                aria-current={p === page ? 'page' : undefined}
                className={`px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  p === page
                    ? 'bg-[#141413] text-white'
                    : 'bg-white border border-[#D9D9D3] text-[#383833] hover:bg-[#F0F0EC]'
                }`}
              >
                {p}
              </button>
            )
          )}
          <button
            onClick={() => onPageChange(page + 1)}
            disabled={page >= totalPages}
            className="px-2.5 py-1.5 text-xs font-medium rounded-md border border-[#D9D9D3] bg-white text-[#383833] disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[#F0F0EC] transition-colors"
            aria-label="Next page"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  )
}

export default function DashboardClient({
  initialSettings,
  initialNiches,
  initialLeads,
  stats,
  statusCounts,
  defaultIndustries,
  defaultCities,
}: DashboardClientProps) {
  const router = useRouter()
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  )
  const [activeTab, setActiveTab] = useState<'leads' | 'targeting' | 'settings'>('leads')

  // Leads state
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [searchQuery, setSearchQuery] = useState<string>('')
  const [expandedLeadId, setExpandedLeadId] = useState<string | null>(null)
  const [leadsPage, setLeadsPage] = useState(1)
  const [leadsPageSize, setLeadsPageSize] = useState(25)
  const [nichesPage, setNichesPage] = useState(1)
  const [nichesPageSize, setNichesPageSize] = useState(10)

  // Settings state
  const [dailyCap, setDailyCap] = useState(initialSettings.daily_cap)
  const [paused, setPaused] = useState(initialSettings.paused)
  const [settingsLoading, setSettingsLoading] = useState(false)
  const [settingsMessage, setSettingsMessage] = useState('')

  const [prevSettings, setPrevSettings] = useState(initialSettings)
  if (prevSettings !== initialSettings) {
    setPrevSettings(initialSettings)
    setDailyCap(initialSettings.daily_cap)
    setPaused(initialSettings.paused)
  }

  const dialogRef = useRef<HTMLDivElement>(null)
  const selectedLead = initialLeads.find((lead) => lead.id === expandedLeadId) || null
  const isEmailModalOpen = expandedLeadId !== null && selectedLead !== null

  const FOCUSABLE_SELECTOR = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'

  useEffect(() => {
    if (!isEmailModalOpen) return
    const dialog = dialogRef.current
    const previouslyFocused = document.activeElement as HTMLElement | null
    dialog?.focus()

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setExpandedLeadId(null)
        return
      }
      if (e.key !== 'Tab' || !dialog) return
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      const active = document.activeElement as HTMLElement | null
      if (e.shiftKey && (active === first || active === dialog)) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && (active === last || active === dialog)) {
        e.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = ''
      previouslyFocused?.focus?.()
    }
  }, [isEmailModalOpen])

  // Determine which industries and cities are currently active based on initialNiches
  const activeNiches = initialNiches.filter((n) => n.status === 'active')
  const activeIndustrySet = new Set(activeNiches.map((n) => n.label))
  const activeCitySet = new Set(activeNiches.map((n) => n.city))

  // Targeting state: initialize with currently active ones or fallback to default ones if none
  const [selectedIndustries, setSelectedIndustries] = useState<string[]>(
    defaultIndustries.filter((ind) => activeIndustrySet.has(ind)).length >= 3
      ? defaultIndustries.filter((ind) => activeIndustrySet.has(ind))
      : defaultIndustries.slice(0, 3)
  )
  const [selectedCities, setSelectedCities] = useState<string[]>(
    defaultCities.filter((city) => activeCitySet.has(city)).length >= 3
      ? defaultCities.filter((city) => activeCitySet.has(city))
      : defaultCities.slice(0, 3)
  )
  const [targetingLoading, setTargetingLoading] = useState(false)
  const [targetingError, setTargetingError] = useState('')
  const [targetingSuccess, setTargetingSuccess] = useState('')

  // Custom niche form state
  const [customLabel, setCustomLabel] = useState('')
  const [customCity, setCustomCity] = useState('')
  const [customLoading, setCustomLoading] = useState(false)

  // Filter leads
  const filteredLeads = initialLeads.filter((lead) => {
    const matchesStatus = statusFilter === 'all' || lead.status === statusFilter
    const matchesSearch =
      !searchQuery ||
      lead.business_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (lead.email && lead.email.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (lead.website && lead.website.toLowerCase().includes(searchQuery.toLowerCase()))
    return matchesStatus && matchesSearch
  })

  // Reset pagination whenever the filter or search changes
  const applyStatusFilter = (st: string) => {
    setStatusFilter(st)
    setLeadsPage(1)
  }
  const applySearchQuery = (q: string) => {
    setSearchQuery(q)
    setLeadsPage(1)
  }

  const leadsTotalPages = Math.max(1, Math.ceil(filteredLeads.length / leadsPageSize))
  const currentLeadsPage = Math.min(leadsPage, leadsTotalPages)
  const pagedLeads = filteredLeads.slice(
    (currentLeadsPage - 1) * leadsPageSize,
    currentLeadsPage * leadsPageSize
  )

  const nichesTotalPages = Math.max(1, Math.ceil(initialNiches.length / nichesPageSize))
  const currentNichesPage = Math.min(nichesPage, nichesTotalPages)
  const pagedNiches = initialNiches.slice(
    (currentNichesPage - 1) * nichesPageSize,
    currentNichesPage * nichesPageSize
  )

  // Handlers
  const handleUpdateSettings = async (e: React.FormEvent) => {
    e.preventDefault()
    setSettingsLoading(true)
    setSettingsMessage('')

    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'update_settings', daily_cap: dailyCap, paused }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to update settings')
      setSettingsMessage('Settings saved successfully.')
      router.refresh()
    } catch (err: unknown) {
      setSettingsMessage(err instanceof Error ? err.message : 'Failed to update settings')
    } finally {
      setSettingsLoading(false)
    }
  }

  const handleToggleIndustry = (industry: string) => {
    if (selectedIndustries.includes(industry)) {
      if (selectedIndustries.length <= 3) {
        setTargetingError('Minimum 3 industries must remain selected.')
        return
      }
      setSelectedIndustries(selectedIndustries.filter((i) => i !== industry))
    } else {
      setSelectedIndustries([...selectedIndustries, industry])
      setTargetingError('')
    }
  }

  const handleToggleCity = (city: string) => {
    if (selectedCities.includes(city)) {
      if (selectedCities.length <= 3) {
        setTargetingError('Minimum 3 cities must remain selected.')
        return
      }
      setSelectedCities(selectedCities.filter((c) => c !== city))
    } else {
      setSelectedCities([...selectedCities, city])
      setTargetingError('')
    }
  }

  const handleSaveTargeting = async () => {
    if (selectedIndustries.length < 3 || selectedCities.length < 3) {
      setTargetingError('Please select at least 3 industries and 3 cities.')
      return
    }

    setTargetingLoading(true)
    setTargetingError('')
    setTargetingSuccess('')

    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'save_targeting', industries: selectedIndustries, cities: selectedCities }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to save targeting')
      setTargetingSuccess('Targeting pools updated successfully.')
      router.refresh()
    } catch (err: unknown) {
      setTargetingError(err instanceof Error ? err.message : 'Failed to save targeting')
    } finally {
      setTargetingLoading(false)
    }
  }

  const handleAddCustomNiche = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!customLabel || !customCity) return

    setCustomLoading(true)
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'add_custom_niche', label: customLabel, city: customCity }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to add custom niche')
      setCustomLabel('')
      setCustomCity('')
      router.refresh()
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to add custom niche')
    } finally {
      setCustomLoading(false)
    }
  }

  // Calculate opening rate
  const openRate = stats.sent_total > 0 ? ((stats.opened_total / stats.sent_total) * 100).toFixed(1) : '0.0'

  function seoScoreInfo(score: number | null) {
    if (score === null) {
      return { label: '—', className: 'bg-[#F0F0EC] text-[#8C8C85] border-[#D9D9D3]', dot: 'bg-[#C7C7C0]' }
    }
    if (score <= 40) {
      return { label: `${score} · Weak`, className: 'bg-rose-50 text-rose-800 border-rose-200', dot: 'bg-rose-600' }
    }
    if (score <= 70) {
      return { label: `${score} · Fair`, className: 'bg-amber-50 text-amber-800 border-amber-200', dot: 'bg-amber-600' }
    }
    return { label: `${score} · Solid`, className: 'bg-emerald-50 text-emerald-800 border-emerald-200', dot: 'bg-emerald-600' }
  }

  return (
    <div className="min-h-screen bg-[#F8F8F5] text-[#141413] font-sans selection:bg-[#141413] selection:text-[#F8F8F5]">
      {/* Editorial Top Header */}
      <header className="border-b border-[#E6E6DF] bg-white/80 backdrop-blur-md sticky top-0 z-30 px-6 py-4">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-[#141413] text-white flex items-center justify-center font-mono font-bold text-sm tracking-tighter shadow-sm">
              CS
            </div>
            <div>
              <h1 className="text-base font-semibold tracking-tight text-[#141413]">ColdStart Operator</h1>
            </div>
          </div>

          <div className="flex items-center gap-4 bg-[#F2F2EE] px-3.5 py-1.5 rounded-full border border-[#E0E0D8]">
            <div className="flex items-center gap-2">
              <span
                className={`w-2 h-2 rounded-full animate-pulse ${
                  paused ? 'bg-amber-500' : 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]'
                }`}
              />
              <span className="text-xs font-medium uppercase tracking-wider text-[#383833]">
                {paused ? 'Pipeline Paused' : 'Pipeline Running'}
              </span>
            </div>
            <span className="text-[#D0D0C8]">|</span>
            <span className="text-xs text-[#6B6B65] font-mono">
              Sync: {!initialSettings.last_run_at ? 'Never' : mounted ? new Date(initialSettings.last_run_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '…'}
            </span>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-8">
        {/* Stats Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white p-5 rounded-xl border border-[#E6E6DF] shadow-[0_1px_3px_rgba(0,0,0,0.02)] relative overflow-hidden group hover:border-[#CCCCCC] transition-colors">
            <div className="absolute top-0 left-0 right-0 h-[2px] bg-[#141413]" />
            <p className="text-[11px] font-mono uppercase tracking-widest text-[#71716B]">Total Prospect Pool</p>
            <div className="flex items-baseline justify-between mt-2">
              <span className="text-3xl font-semibold tracking-tight text-[#141413] font-mono">{stats.total}</span>
              <span className="text-xs font-medium text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200/60">
                Active DB
              </span>
            </div>
          </div>

          <div className="bg-white p-5 rounded-xl border border-[#E6E6DF] shadow-[0_1px_3px_rgba(0,0,0,0.02)] relative overflow-hidden group hover:border-[#CCCCCC] transition-colors">
            <div className="absolute top-0 left-0 right-0 h-[2px] bg-amber-600" />
            <p className="text-[11px] font-mono uppercase tracking-widest text-[#71716B]">Sent Today / Cap</p>
            <div className="flex items-baseline justify-between mt-2">
              <span className="text-3xl font-semibold tracking-tight text-[#141413] font-mono">
                {stats.sent_today} <span className="text-sm text-[#8C8C85] font-normal">/ {initialSettings.daily_cap}</span>
              </span>
              <div className="w-16 bg-[#EFEFED] h-2 rounded-full overflow-hidden border border-[#D9D9D3]">
                <div
                  className="bg-amber-600 h-full rounded-full transition-all duration-500"
                  style={{ width: `${Math.min(100, (stats.sent_today / Math.max(1, initialSettings.daily_cap)) * 100)}%` }}
                />
              </div>
            </div>
          </div>

          <div className="bg-white p-5 rounded-xl border border-[#E6E6DF] shadow-[0_1px_3px_rgba(0,0,0,0.02)] relative overflow-hidden group hover:border-[#CCCCCC] transition-colors">
            <div className="absolute top-0 left-0 right-0 h-[2px] bg-blue-600" />
            <p className="text-[11px] font-mono uppercase tracking-widest text-[#71716B]">Total Dispatched</p>
            <div className="flex items-baseline justify-between mt-2">
              <span className="text-3xl font-semibold tracking-tight text-[#141413] font-mono">{stats.sent_total}</span>
              <span className="text-xs font-mono text-[#6B6B65]">emails delivered</span>
            </div>
          </div>

          <div className="bg-white p-5 rounded-xl border border-[#E6E6DF] shadow-[0_1px_3px_rgba(0,0,0,0.02)] relative overflow-hidden group hover:border-[#CCCCCC] transition-colors">
            <div className="absolute top-0 left-0 right-0 h-[2px] bg-emerald-600" />
            <p className="text-[11px] font-mono uppercase tracking-widest text-[#71716B]">Open Engagement Rate</p>
            <div className="flex items-baseline justify-between mt-2">
              <span className="text-3xl font-semibold tracking-tight text-[#141413] font-mono">{openRate}%</span>
              <span className="text-xs font-medium text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200/60">
                {stats.opened_total} opened
              </span>
            </div>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="border-b border-[#E6E6DF] flex items-center justify-between">
          <nav className="-mb-px flex space-x-8">
            <button
              onClick={() => setActiveTab('leads')}
              className={`py-3.5 px-1 border-b-2 font-medium text-sm transition-colors flex items-center gap-2 ${
                activeTab === 'leads'
                  ? 'border-[#141413] text-[#141413]'
                  : 'border-transparent text-[#71716B] hover:text-[#383833] hover:border-[#CCCCCC]'
              }`}
            >
              <span>Leads Directory</span>
              <span className="text-xs font-mono px-2 py-0.5 rounded-full bg-[#EFEFED] text-[#595955] border border-[#D9D9D3]">
                {initialLeads.length}
              </span>
            </button>
            <button
              onClick={() => setActiveTab('targeting')}
              className={`py-3.5 px-1 border-b-2 font-medium text-sm transition-colors flex items-center gap-2 ${
                activeTab === 'targeting'
                  ? 'border-[#141413] text-[#141413]'
                  : 'border-transparent text-[#71716B] hover:text-[#383833] hover:border-[#CCCCCC]'
              }`}
            >
              <span>Targeting Matrix</span>
              <span className="text-xs font-mono px-2 py-0.5 rounded-full bg-[#EFEFED] text-[#595955] border border-[#D9D9D3]">
                {initialNiches.length}
              </span>
            </button>
            <button
              onClick={() => setActiveTab('settings')}
              className={`py-3.5 px-1 border-b-2 font-medium text-sm transition-colors ${
                activeTab === 'settings'
                  ? 'border-[#141413] text-[#141413]'
                  : 'border-transparent text-[#71716B] hover:text-[#383833] hover:border-[#CCCCCC]'
              }`}
            >
              Pipeline Settings
            </button>
          </nav>
        </div>

        {/* Tab 1: Leads */}
        {activeTab === 'leads' && (
          <div className="bg-white rounded-xl border border-[#E6E6DF] shadow-[0_1px_3px_rgba(0,0,0,0.02)] overflow-hidden">
            <div className="p-4 sm:p-5 border-b border-[#E6E6DF] bg-[#FAFAF7] flex flex-col sm:flex-row justify-between items-center gap-4">
              <div className="flex items-center gap-1.5 w-full sm:flex-1 sm:min-w-0">
                <div className="hidden sm:flex flex-nowrap items-center gap-1.5 overflow-x-auto">
                  {LEAD_STATUS_TABS.map((st) => {
                    const count = st === 'all' ? stats.total : statusCounts[st] || 0
                    return (
                      <button
                        key={st}
                        onClick={() => applyStatusFilter(st)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium capitalize transition-all flex items-center gap-1.5 whitespace-nowrap ${
                          statusFilter === st
                            ? 'bg-[#141413] text-white shadow-sm'
                            : 'bg-white text-[#595955] hover:bg-[#F0F0EC] border border-[#E0E0D8]'
                        }`}
                      >
                        {st.replace('_', ' ')}
                        <span
                          className={`px-1.5 py-0.5 rounded-full text-[10px] font-mono leading-none ${
                            statusFilter === st
                              ? 'bg-white/15 text-white'
                              : 'bg-[#EFEFED] text-[#595955] border border-[#D9D9D3]'
                          }`}
                        >
                          {count}
                        </span>
                      </button>
                    )
                  })}
                </div>
                <div className="sm:hidden flex items-center gap-2 w-full">
                  <label htmlFor="status-filter" className="text-xs font-medium text-[#595955] shrink-0">
                    Status
                  </label>
                  <select
                    id="status-filter"
                    value={statusFilter}
                    onChange={(e) => applyStatusFilter(e.target.value)}
                    className="flex-1 px-3.5 py-2 text-sm bg-white border border-[#D9D9D3] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#141413]/20 focus:border-[#141413] transition-all"
                  >
                    {LEAD_STATUS_TABS.map((st) => {
                      const count = st === 'all' ? stats.total : statusCounts[st] || 0
                      const label = st === 'all' ? 'All leads' : st.replace('_', ' ')
                      return (
                        <option key={st} value={st}>
                          {label} ({count})
                        </option>
                      )
                    })}
                  </select>
                </div>
              </div>
              <div className="w-full sm:w-auto sm:shrink-0">
                <input
                  type="text"
                  placeholder="Filter by business, email, website..."
                  value={searchQuery}
                  onChange={(e) => applySearchQuery(e.target.value)}
                  className="w-full sm:w-72 px-3.5 py-2 text-sm bg-white border border-[#D9D9D3] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#141413]/20 focus:border-[#141413] transition-all"
                />
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-[#F5F5F0] border-b border-[#E6E6DF] text-[#6B6B65] font-mono text-xs uppercase tracking-wider">
                  <tr>
                    <th className="px-6 py-3.5 font-medium w-[30%] min-w-[220px]">Business / Location</th>
                    <th className="px-6 py-3.5 font-medium w-[11%] min-w-[115px]">Pipeline Status</th>
                    <th className="px-6 py-3.5 font-medium w-[10%] min-w-[110px]">SEO Weakness</th>
                    <th className="px-6 py-3.5 font-medium w-[17%] min-w-[150px]">Website</th>
                    <th className="px-6 py-3.5 font-medium w-[22%] min-w-[180px]">Email Address</th>
                    <th className="px-6 py-3.5 font-medium w-[11%] min-w-[110px]">Sent Timestamp</th>
                    <th className="px-6 py-3.5 font-medium w-[5%] min-w-[80px]">Engagement</th>
                    <th className="px-6 py-3.5 font-medium w-[5%] min-w-[100px]"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#EFEFED]">
                  {filteredLeads.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-6 py-12 text-center text-[#71716B]">
                        <div className="max-w-xs mx-auto space-y-2">
                          <p className="font-medium text-[#383833]">No leads found matching current filter</p>
                          <p className="text-xs text-[#8C8C85]">Try adjusting your search query or status filter above.</p>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    pagedLeads.map((lead) => (
                      <tr key={lead.id} className="hover:bg-[#FCFCFA] transition-colors">
                        <td className="px-6 py-4">
                          <div className="font-medium text-[#141413] truncate" title={lead.business_name}>{lead.business_name}</div>
                          {lead.address && <div className="text-xs text-[#71716B] mt-0.5 truncate">{lead.address}</div>}
                        </td>
                        <td className="px-6 py-4">
                          <span
                            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium capitalize border ${
                              lead.status === 'sent' || lead.status === 'followed_up'
                                ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                                : lead.status === 'failed'
                                ? 'bg-rose-50 text-rose-800 border-rose-200'
                                : lead.status === 'skipped'
                                ? 'bg-slate-50 text-slate-700 border-slate-200'
                                : lead.status === 'no_website'
                                ? 'bg-orange-50 text-orange-800 border-orange-200'
                                : lead.status === 'generated' || lead.status === 'scraped'
                                ? 'bg-sky-50 text-sky-800 border-sky-200'
                                : 'bg-[#F0F0EC] text-[#595955] border-[#D9D9D3]'
                            }`}
                          >
                            <span className={`w-1.5 h-1.5 rounded-full ${
                              lead.status === 'sent' || lead.status === 'followed_up'
                                ? 'bg-emerald-600'
                                : lead.status === 'failed'
                                ? 'bg-rose-600'
                                : lead.status === 'skipped'
                                ? 'bg-slate-500'
                                : lead.status === 'no_website'
                                ? 'bg-orange-600'
                                : lead.status === 'generated' || lead.status === 'scraped'
                                ? 'bg-sky-600'
                                : 'bg-[#8C8C85]'
                            }`} />
                            {lead.status.replace('_', ' ')}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          {(() => {
                            const info = seoScoreInfo(lead.seo_score)
                            return (
                              <span
                                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium capitalize border whitespace-nowrap ${info.className}`}
                                title={lead.seo_flags ? lead.seo_flags.split(',').join(', ') : 'No SEO flags recorded'}
                              >
                                <span className={`w-1.5 h-1.5 rounded-full ${info.dot}`} />
                                {info.label}
                              </span>
                            )
                          })()}
                        </td>
                        <td className="px-6 py-4 font-mono text-xs text-[#595955]">
                          {lead.website ? (
                            <a
                              href={lead.website.startsWith('http') ? lead.website : `https://${lead.website}`}
                              target="_blank"
                              rel="noreferrer"
                              title={lead.website.replace(/^https?:\/\//, '')}
                              className="text-blue-600 hover:underline inline-flex items-center gap-1 max-w-full"
                            >
                              <span className="truncate">{lead.website.replace(/^https?:\/\//, '')}</span>
                              <svg className="w-3 h-3 opacity-60 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                              </svg>
                            </a>
                          ) : (
                            <span className="text-[#A3A39E] italic">Unlisted</span>
                          )}
                        </td>
                        <td className="px-6 py-4 font-mono text-xs text-[#383833] truncate">
                          {lead.email ? (
                            <a href={`mailto:${lead.email}`} className="hover:underline" title={lead.email}>
                              {lead.email}
                            </a>
                          ) : (
                            <span className="text-[#A3A39E] italic font-sans">No email found</span>
                          )}
                        </td>
                        <td className="px-6 py-4 font-mono text-xs text-[#71716B] truncate">
                          {lead.initial_sent_at ? (mounted ? new Date(lead.initial_sent_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : '…') : '—'}
                          {lead.followup_sent_at && (
                            <div className="text-[10px] text-[#A3A39E] mt-0.5">
                              FU: {mounted ? new Date(lead.followup_sent_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '…'}
                            </div>
                          )}
                        </td>
                        <td className="px-6 py-4">
                          {lead.initial_opened_at ? (
                            <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-600 animate-pulse" />
                              Opened
                            </span>
                          ) : (
                            <span className="text-xs text-[#A3A39E]">—</span>
                          )}
                        </td>
                        <td className="px-6 py-4">
                          {(lead.generated_subject || lead.followup_subject) && (
                            <button
                              onClick={() => setExpandedLeadId(lead.id)}
                              className="inline-flex items-center gap-1 text-xs font-semibold whitespace-nowrap text-white bg-blue-600 hover:bg-blue-700 px-3 py-1.5 rounded-lg transition-colors shadow-sm"
                            >
                              View Email
                            </button>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <PaginationControls
              page={currentLeadsPage}
              pageSize={leadsPageSize}
              total={filteredLeads.length}
              onPageChange={setLeadsPage}
              onPageSizeChange={(size) => {
                setLeadsPageSize(size)
                setLeadsPage(1)
              }}
            />
          </div>
        )}

        {/* Tab 2: Targeting & Niches */}
        {activeTab === 'targeting' && (
          <div className="space-y-6">
            <div className="bg-white p-6 sm:p-8 rounded-xl border border-[#E6E6DF] shadow-[0_1px_3px_rgba(0,0,0,0.02)]">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
                <div>
                  <h2 className="text-lg font-semibold tracking-tight text-[#141413]">Targeting Matrix & Discovery Pools</h2>
                  <p className="text-sm text-[#71716B] mt-0.5">
                    Configure your geographic and industrial discovery matrix. Minimum 3 industries and 3 cities required.
                  </p>
                </div>
                <div className="bg-[#F5F5F0] px-3.5 py-2 rounded-lg border border-[#E0E0D8] text-right">
                  <div className="text-[10px] font-mono uppercase tracking-wider text-[#71716B]">Active Combinations</div>
                  <div className="text-base font-mono font-semibold text-[#141413]">
                    {selectedIndustries.length} × {selectedCities.length} = {selectedIndustries.length * selectedCities.length} pools
                  </div>
                </div>
              </div>

              {targetingError && (
                <div className="mb-6 p-4 bg-rose-50 border border-rose-200 text-rose-800 text-sm rounded-lg flex items-center gap-3">
                  <svg className="w-5 h-5 text-rose-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                  <span>{targetingError}</span>
                </div>
              )}
              {targetingSuccess && (
                <div className="mb-6 p-4 bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm rounded-lg flex items-center gap-3">
                  <svg className="w-5 h-5 text-emerald-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  <span>{targetingSuccess}</span>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-6">
                <div className="space-y-3">
                  <div className="flex justify-between items-center">
                    <h3 className="text-xs font-mono uppercase tracking-widest text-[#71716B]">Industries ({selectedIndustries.length} selected)</h3>
                    <span className="text-[11px] text-[#8C8C85]">Min 3 required</span>
                  </div>
                  <div className="space-y-1.5 max-h-72 overflow-y-auto p-3 bg-[#FAFAF7] border border-[#E6E6DF] rounded-xl">
                    {defaultIndustries.map((ind) => {
                      const isSelected = selectedIndustries.includes(ind)
                      return (
                        <label
                          key={ind}
                          className={`flex items-center gap-3 text-sm cursor-pointer p-2 rounded-lg transition-colors ${
                            isSelected ? 'bg-white shadow-xs border border-[#D9D9D3] font-medium text-[#141413]' : 'hover:bg-[#F0F0EC] text-[#595955]'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => handleToggleIndustry(ind)}
                            className="w-4 h-4 rounded border-[#D9D9D3] text-[#141413] focus:ring-[#141413]"
                          />
                          <span>{ind}</span>
                        </label>
                      )
                    })}
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="flex justify-between items-center">
                    <h3 className="text-xs font-mono uppercase tracking-widest text-[#71716B]">US Target Cities ({selectedCities.length} selected)</h3>
                    <span className="text-[11px] text-[#8C8C85]">Min 3 required</span>
                  </div>
                  <div className="space-y-1.5 max-h-72 overflow-y-auto p-3 bg-[#FAFAF7] border border-[#E6E6DF] rounded-xl">
                    {defaultCities.map((city) => {
                      const isSelected = selectedCities.includes(city)
                      return (
                        <label
                          key={city}
                          className={`flex items-center gap-3 text-sm cursor-pointer p-2 rounded-lg transition-colors ${
                            isSelected ? 'bg-white shadow-xs border border-[#D9D9D3] font-medium text-[#141413]' : 'hover:bg-[#F0F0EC] text-[#595955]'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => handleToggleCity(city)}
                            className="w-4 h-4 rounded border-[#D9D9D3] text-[#141413] focus:ring-[#141413]"
                          />
                          <span>{city}</span>
                        </label>
                      )
                    })}
                  </div>
                </div>
              </div>

              <div className="flex justify-end pt-5 border-t border-[#E6E6DF]">
                <button
                  onClick={handleSaveTargeting}
                  disabled={targetingLoading}
                  className="px-5 py-2.5 bg-[#141413] text-white text-sm font-medium rounded-xl hover:bg-[#2E2E2A] transition-all disabled:opacity-50 shadow-sm flex items-center gap-2"
                >
                  {targetingLoading ? (
                    <>
                      <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      <span>Updating Matrix...</span>
                    </>
                  ) : (
                    <span>Save Targeting Matrix</span>
                  )}
                </button>
              </div>
            </div>

            {/* Add Custom Niche Form */}
            <div className="bg-white p-6 sm:p-8 rounded-xl border border-[#E6E6DF] shadow-[0_1px_3px_rgba(0,0,0,0.02)]">
              <h2 className="text-lg font-semibold tracking-tight text-[#141413] mb-1">Add Custom Discovery Niche</h2>
              <p className="text-sm text-[#71716B] mb-5">Inject a specialized industry & location pair directly into the autonomous discovery runner.</p>
              <form onSubmit={handleAddCustomNiche} className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <input
                  type="text"
                  placeholder="Industry label (e.g. Boutique Gym)"
                  value={customLabel}
                  onChange={(e) => setCustomLabel(e.target.value)}
                  required
                  className="px-3.5 py-2.5 text-sm bg-white border border-[#D9D9D3] rounded-xl focus:outline-none focus:ring-2 focus:ring-[#141413]/20 focus:border-[#141413]"
                />
                <input
                  type="text"
                  placeholder="City (e.g. Austin, TX)"
                  value={customCity}
                  onChange={(e) => setCustomCity(e.target.value)}
                  required
                  className="px-3.5 py-2.5 text-sm bg-white border border-[#D9D9D3] rounded-xl focus:outline-none focus:ring-2 focus:ring-[#141413]/20 focus:border-[#141413]"
                />
                <button
                  type="submit"
                  disabled={customLoading}
                  className="px-5 py-2.5 bg-[#141413] text-white text-sm font-medium rounded-xl hover:bg-[#2E2E2A] transition-all disabled:opacity-50 shadow-sm"
                >
                  {customLoading ? 'Adding Niche...' : 'Add Custom Niche'}
                </button>
              </form>
            </div>

            {/* Existing Niches Table */}
            <div className="bg-white rounded-xl border border-[#E6E6DF] shadow-[0_1px_3px_rgba(0,0,0,0.02)] overflow-hidden">
              <div className="p-5 border-b border-[#E6E6DF] bg-[#FAFAF7]">
                <h2 className="text-base font-semibold tracking-tight text-[#141413]">All Registered Niches ({initialNiches.length})</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-[#F5F5F0] border-b border-[#E6E6DF] text-[#6B6B65] font-mono text-xs uppercase tracking-wider">
                    <tr>
                      <th className="px-6 py-3.5 font-medium">Industry Label</th>
                      <th className="px-6 py-3.5 font-medium">City Target</th>
                      <th className="px-6 py-3.5 font-medium">Status</th>
                      <th className="px-6 py-3.5 font-medium">Source Origin</th>
                      <th className="px-6 py-3.5 font-medium">AI Reasoning</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#EFEFED]">
                    {pagedNiches.map((niche) => (
                      <tr key={niche.id} className="hover:bg-[#FCFCFA] transition-colors">
                        <td className="px-6 py-4 font-medium text-[#141413]">{niche.label}</td>
                        <td className="px-6 py-4 text-[#595955]">{niche.city}</td>
                        <td className="px-6 py-4">
                          <span
                            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium capitalize border ${
                              niche.status === 'active'
                                ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                                : 'bg-[#F0F0EC] text-[#595955] border-[#D9D9D3]'
                            }`}
                          >
                            <span className={`w-1.5 h-1.5 rounded-full ${niche.status === 'active' ? 'bg-emerald-600' : 'bg-[#8C8C85]'}`} />
                            {niche.status}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-[#595955] font-mono text-xs capitalize">{niche.source.replace('_', ' ')}</td>
                        <td className="px-6 py-4 text-[#71716B] text-xs max-w-md truncate">{niche.reasoning || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <PaginationControls
                page={currentNichesPage}
                pageSize={nichesPageSize}
                total={initialNiches.length}
                onPageChange={setNichesPage}
                onPageSizeChange={(size) => {
                  setNichesPageSize(size)
                  setNichesPage(1)
                }}
              />
            </div>
          </div>
        )}

        {/* Tab 3: Settings */}
        {activeTab === 'settings' && (
          <div className="bg-white p-6 sm:p-8 rounded-xl border border-[#E6E6DF] shadow-[0_1px_3px_rgba(0,0,0,0.02)] max-w-2xl">
            <h2 className="text-lg font-semibold tracking-tight text-[#141413] mb-1">Pipeline Global Settings</h2>
            <p className="text-sm text-[#71716B] mb-6">Manage automated delivery volume caps and emergency pause switches.</p>

            {settingsMessage && (
              <div className="mb-6 p-4 bg-[#F2F2EE] border border-[#D9D9D3] text-[#141413] text-sm rounded-xl font-medium">
                {settingsMessage}
              </div>
            )}

            <form onSubmit={handleUpdateSettings} className="space-y-6">
              <div>
                <label className="block text-xs font-mono uppercase tracking-widest text-[#71716B] mb-2">Daily Send Capacity Cap</label>
                <input
                  type="number"
                  min="1"
                  max="100"
                  value={dailyCap}
                  onChange={(e) => setDailyCap(parseInt(e.target.value, 10) || 1)}
                  className="w-full px-3.5 py-2.5 text-sm bg-white border border-[#D9D9D3] rounded-xl focus:outline-none focus:ring-2 focus:ring-[#141413]/20 focus:border-[#141413]"
                />
                <p className="text-xs text-[#8C8C85] mt-1.5">Applies to initial sends only and does not count follow-ups. Initial sends are hard-capped at 50/day; follow-ups run on a separate 50/day budget. Combined total stays within Resend&apos;s 100/day free tier ceiling.</p>
              </div>

              <div className="flex items-center justify-between p-5 bg-[#FAFAF7] rounded-xl border border-[#E6E6DF]">
                <div>
                  <span className="block text-sm font-semibold text-[#141413]">Emergency Pause All Sending</span>
                  <span className="block text-xs text-[#71716B] mt-0.5">Instantly halts outgoing emails across all scheduled tasks.</span>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={paused}
                    onChange={(e) => setPaused(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-[#D9D9D3] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-[#CCCCCC] after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#141413]" />
                </label>
              </div>

              <div className="pt-5 border-t border-[#E6E6DF] flex justify-end">
                <button
                  type="submit"
                  disabled={settingsLoading}
                  className="px-5 py-2.5 bg-[#141413] text-white text-sm font-medium rounded-xl hover:bg-[#2E2E2A] transition-all disabled:opacity-50 shadow-sm flex items-center gap-2"
                >
                  {settingsLoading ? (
                    <>
                      <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      <span>Saving Settings...</span>
                    </>
                  ) : (
                    <span>Save Settings</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        )}
      </main>

      {/* Email Detail Modal */}
      {selectedLead && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
          <div
            className="absolute inset-0 bg-[#141413]/50 backdrop-blur-sm"
            onClick={() => setExpandedLeadId(null)}
          />
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            tabIndex={-1}
            aria-label={`Email detail for ${selectedLead.business_name}`}
            className="relative bg-white w-full max-w-2xl max-h-[85vh] flex flex-col rounded-2xl border border-[#E6E6DF] shadow-2xl overflow-hidden focus:outline-none"
          >
            <div className="px-6 py-5 border-b border-[#E6E6DF] bg-[#FAFAF7] flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h2 className="text-base font-semibold tracking-tight text-[#141413] truncate">{selectedLead.business_name}</h2>
                <p className="text-xs font-mono text-[#71716B] mt-0.5 truncate">
                  {selectedLead.email || 'No email on file'}
                  {selectedLead.address ? ` · ${selectedLead.address}` : ''}
                </p>
              </div>
              <button
                onClick={() => setExpandedLeadId(null)}
                aria-label="Close email detail"
                className="shrink-0 w-8 h-8 inline-flex items-center justify-center rounded-lg text-[#595955] hover:bg-[#ECECE7] hover:text-[#141413] transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="px-6 py-5 overflow-y-auto space-y-5">
              {selectedLead.generated_subject && (
                <div className="bg-[#FAFAF7] border border-[#E6E6DF] rounded-xl p-5">
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-[10px] font-mono uppercase tracking-widest text-[#71716B] bg-white border border-[#E0E0D8] px-2 py-0.5 rounded">Initial Email</span>
                    {selectedLead.initial_sent_at && (
                      <span className="text-[11px] font-mono text-[#8C8C85]">
                        Sent {mounted ? new Date(selectedLead.initial_sent_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '…'}
                      </span>
                    )}
                  </div>
                  <div className="font-semibold text-[#141413] mb-2">{selectedLead.generated_subject}</div>
                  <p className="text-sm text-[#383833] whitespace-pre-wrap leading-relaxed">{selectedLead.generated_body || '—'}</p>
                </div>
              )}
              {selectedLead.followup_subject && (
                <div className="bg-[#FAFAF7] border border-[#E6E6DF] rounded-xl p-5">
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-[10px] font-mono uppercase tracking-widest text-[#71716B] bg-white border border-[#E0E0D8] px-2 py-0.5 rounded">Follow-up Email</span>
                    {selectedLead.followup_sent_at && (
                      <span className="text-[11px] font-mono text-[#8C8C85]">
                        Sent {mounted ? new Date(selectedLead.followup_sent_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '…'}
                      </span>
                    )}
                  </div>
                  <div className="font-semibold text-[#141413] mb-2">{selectedLead.followup_subject}</div>
                  <p className="text-sm text-[#383833] whitespace-pre-wrap leading-relaxed">{selectedLead.followup_body || '—'}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
