'use client'

import React, { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'

interface Lead {
  id: string
  business_name: string
  address: string | null
  website: string | null
  email: string | null
  status: string
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
  defaultIndustries: string[]
  defaultCities: string[]
}

export default function DashboardClient({
  initialSettings,
  initialNiches,
  initialLeads,
  stats,
  defaultIndustries,
  defaultCities,
}: DashboardClientProps) {
  const router = useRouter()
  const [activeTab, setActiveTab] = useState<'leads' | 'targeting' | 'settings'>('leads')

  // Leads state
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [searchQuery, setSearchQuery] = useState<string>('')

  // Settings state
  const [dailyCap, setDailyCap] = useState(initialSettings.daily_cap)
  const [paused, setPaused] = useState(initialSettings.paused)
  const [settingsLoading, setSettingsLoading] = useState(false)
  const [settingsMessage, setSettingsMessage] = useState('')

  useEffect(() => {
    setDailyCap(initialSettings.daily_cap)
    setPaused(initialSettings.paused)
  }, [initialSettings])

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
    } catch (err: any) {
      setSettingsMessage(err.message)
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
    } catch (err: any) {
      setTargetingError(err.message)
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
    } catch (err: any) {
      alert(err.message)
    } finally {
      setCustomLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900 font-sans">
      {/* Top Header */}
      <header className="border-b border-zinc-200 bg-white px-6 py-4">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-xl font-bold tracking-tight">Cold Outreach Pipeline</h1>
            <p className="text-sm text-zinc-500">Autonomous lead generation, personalization, and sending.</p>
          </div>
          <div className="flex items-center gap-3">
            <span
              className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${
                paused ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'
              }`}
            >
              {paused ? 'Paused' : 'Active'}
            </span>
            <span className="text-xs text-zinc-500">
              Last Run: {initialSettings.last_run_at ? new Date(initialSettings.last_run_at).toLocaleString() : 'Never'}
            </span>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
        {/* Stats Row */}
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 mb-8">
          <div className="bg-white p-5 rounded-lg border border-zinc-200 shadow-sm">
            <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider">Total Leads</p>
            <p className="text-2xl font-semibold mt-1">{stats.total}</p>
          </div>
          <div className="bg-white p-5 rounded-lg border border-zinc-200 shadow-sm">
            <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider">Sent Today</p>
            <p className="text-2xl font-semibold mt-1">
              {stats.sent_today} / {initialSettings.daily_cap}
            </p>
          </div>
          <div className="bg-white p-5 rounded-lg border border-zinc-200 shadow-sm">
            <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider">Total Sent</p>
            <p className="text-2xl font-semibold mt-1">{stats.sent_total}</p>
          </div>
          <div className="bg-white p-5 rounded-lg border border-zinc-200 shadow-sm">
            <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider">Opened</p>
            <p className="text-2xl font-semibold mt-1">{stats.opened_total}</p>
          </div>
        </div>

        {/* Tabs */}
        <div className="border-b border-zinc-200 mb-6">
          <nav className="-mb-px flex space-x-8">
            <button
              onClick={() => setActiveTab('leads')}
              className={`py-4 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'leads'
                  ? 'border-zinc-900 text-zinc-950'
                  : 'border-transparent text-zinc-500 hover:text-zinc-700 hover:border-zinc-300'
              }`}
            >
              Leads ({initialLeads.length})
            </button>
            <button
              onClick={() => setActiveTab('targeting')}
              className={`py-4 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'targeting'
                  ? 'border-zinc-900 text-zinc-950'
                  : 'border-transparent text-zinc-500 hover:text-zinc-700 hover:border-zinc-300'
              }`}
            >
              Targeting & Niches ({initialNiches.length})
            </button>
            <button
              onClick={() => setActiveTab('settings')}
              className={`py-4 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'settings'
                  ? 'border-zinc-900 text-zinc-950'
                  : 'border-transparent text-zinc-500 hover:text-zinc-700 hover:border-zinc-300'
              }`}
            >
              Settings
            </button>
          </nav>
        </div>

        {/* Tab 1: Leads */}
        {activeTab === 'leads' && (
          <div className="bg-white rounded-lg border border-zinc-200 shadow-sm overflow-hidden">
            <div className="p-4 border-b border-zinc-200 flex flex-col sm:flex-row justify-between items-center gap-4">
              <div className="flex flex-wrap items-center gap-2">
                {['all', 'new', 'scraped', 'generated', 'sent', 'followed_up', 'failed'].map((st) => (
                  <button
                    key={st}
                    onClick={() => setStatusFilter(st)}
                    className={`px-3 py-1.5 rounded-md text-xs font-medium capitalize transition-colors ${
                      statusFilter === st
                        ? 'bg-zinc-900 text-white'
                        : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'
                    }`}
                  >
                    {st.replace('_', ' ')}
                  </button>
                ))}
              </div>
              <div className="w-full sm:w-auto">
                <input
                  type="text"
                  placeholder="Search business, email, website..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full sm:w-64 px-3 py-1.5 text-sm border border-zinc-300 rounded-md focus:outline-none focus:ring-1 focus:ring-zinc-900"
                />
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-zinc-50 border-b border-zinc-200 text-zinc-500 font-medium">
                  <tr>
                    <th className="px-6 py-3">Business Name</th>
                    <th className="px-6 py-3">Status</th>
                    <th className="px-6 py-3">Website</th>
                    <th className="px-6 py-3">Email</th>
                    <th className="px-6 py-3">Sent At</th>
                    <th className="px-6 py-3">Opened At</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-200">
                  {filteredLeads.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-6 py-8 text-center text-zinc-500">
                        No leads found matching current filter.
                      </td>
                    </tr>
                  ) : (
                    filteredLeads.map((lead) => (
                      <tr key={lead.id} className="hover:bg-zinc-50">
                        <td className="px-6 py-4 font-medium text-zinc-900">
                          {lead.business_name}
                          {lead.address && <div className="text-xs text-zinc-500 font-normal">{lead.address}</div>}
                        </td>
                        <td className="px-6 py-4">
                          <span
                            className={`inline-flex px-2 py-0.5 rounded text-xs font-medium capitalize ${
                              lead.status === 'sent' || lead.status === 'followed_up'
                                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                : lead.status === 'failed'
                                ? 'bg-red-50 text-red-700 border border-red-200'
                                : lead.status === 'generated' || lead.status === 'scraped'
                                ? 'bg-blue-50 text-blue-700 border border-blue-200'
                                : 'bg-zinc-100 text-zinc-700'
                            }`}
                          >
                            {lead.status.replace('_', ' ')}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-zinc-600 truncate max-w-xs">
                          {lead.website ? (
                            <a
                              href={lead.website.startsWith('http') ? lead.website : `https://${lead.website}`}
                              target="_blank"
                              rel="noreferrer"
                              className="text-blue-600 hover:underline"
                            >
                              {lead.website}
                            </a>
                          ) : (
                            <span className="text-zinc-400 italic">No website</span>
                          )}
                        </td>
                        <td className="px-6 py-4 text-zinc-600">{lead.email || <span className="text-zinc-400 italic">None</span>}</td>
                        <td className="px-6 py-4 text-zinc-500 text-xs">
                          {lead.initial_sent_at ? new Date(lead.initial_sent_at).toLocaleString() : '-'}
                          {lead.followup_sent_at && (
                            <div className="mt-0.5 text-zinc-400">
                              Fu: {new Date(lead.followup_sent_at).toLocaleString()}
                            </div>
                          )}
                        </td>
                        <td className="px-6 py-4 text-zinc-500 text-xs">
                          {lead.initial_opened_at ? (
                            <span className="text-emerald-600 font-medium">Opened</span>
                          ) : (
                            '-'
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Tab 2: Targeting & Niches */}
        {activeTab === 'targeting' && (
          <div className="space-y-8">
            <div className="bg-white p-6 rounded-lg border border-zinc-200 shadow-sm">
              <h2 className="text-lg font-semibold mb-2">Preset Industries & Cities</h2>
              <p className="text-sm text-zinc-500 mb-6">
                Select your targeting matrix. Minimum 3 industries and 3 cities required (yielding at least 9 active search pools).
              </p>

              {targetingError && (
                <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded-md">
                  {targetingError}
                </div>
              )}
              {targetingSuccess && (
                <div className="mb-4 p-3 bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm rounded-md">
                  {targetingSuccess}
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-6">
                <div>
                  <h3 className="text-sm font-medium text-zinc-700 mb-3">Industries ({selectedIndustries.length} selected)</h3>
                  <div className="space-y-2 max-h-60 overflow-y-auto p-2 border border-zinc-200 rounded-md">
                    {defaultIndustries.map((ind) => (
                      <label key={ind} className="flex items-center gap-2 text-sm cursor-pointer hover:bg-zinc-50 p-1 rounded">
                        <input
                          type="checkbox"
                          checked={selectedIndustries.includes(ind)}
                          onChange={() => handleToggleIndustry(ind)}
                          className="rounded border-zinc-300 text-zinc-900 focus:ring-zinc-900"
                        />
                        {ind}
                      </label>
                    ))}
                  </div>
                </div>

                <div>
                  <h3 className="text-sm font-medium text-zinc-700 mb-3">US Cities ({selectedCities.length} selected)</h3>
                  <div className="space-y-2 max-h-60 overflow-y-auto p-2 border border-zinc-200 rounded-md">
                    {defaultCities.map((city) => (
                      <label key={city} className="flex items-center gap-2 text-sm cursor-pointer hover:bg-zinc-50 p-1 rounded">
                        <input
                          type="checkbox"
                          checked={selectedCities.includes(city)}
                          onChange={() => handleToggleCity(city)}
                          className="rounded border-zinc-300 text-zinc-900 focus:ring-zinc-900"
                        />
                        {city}
                      </label>
                    ))}
                  </div>
                </div>
              </div>

              <div className="flex justify-between items-center pt-4 border-t border-zinc-100">
                <p className="text-xs text-zinc-500">
                  Active search pools generated: {selectedIndustries.length} × {selectedCities.length} ={' '}
                  {selectedIndustries.length * selectedCities.length} combinations
                </p>
                <button
                  onClick={handleSaveTargeting}
                  disabled={targetingLoading}
                  className="px-4 py-2 bg-zinc-900 text-white text-sm font-medium rounded-md hover:bg-zinc-800 disabled:opacity-50"
                >
                  {targetingLoading ? 'Saving...' : 'Save Targeting Grid'}
                </button>
              </div>
            </div>

            {/* Add Custom Niche Form */}
            <div className="bg-white p-6 rounded-lg border border-zinc-200 shadow-sm">
              <h2 className="text-lg font-semibold mb-2">Add Custom Niche</h2>
              <p className="text-sm text-zinc-500 mb-4">Add a specific custom niche and city pair to your discovery pipeline.</p>
              <form onSubmit={handleAddCustomNiche} className="flex flex-col sm:flex-row gap-4">
                <input
                  type="text"
                  placeholder="Industry label (e.g. Dental Clinic)"
                  value={customLabel}
                  onChange={(e) => setCustomLabel(e.target.value)}
                  required
                  className="flex-1 px-3 py-2 text-sm border border-zinc-300 rounded-md focus:outline-none focus:ring-1 focus:ring-zinc-900"
                />
                <input
                  type="text"
                  placeholder="City (e.g. Nashville, TN)"
                  value={customCity}
                  onChange={(e) => setCustomCity(e.target.value)}
                  required
                  className="flex-1 px-3 py-2 text-sm border border-zinc-300 rounded-md focus:outline-none focus:ring-1 focus:ring-zinc-900"
                />
                <button
                  type="submit"
                  disabled={customLoading}
                  className="px-4 py-2 bg-zinc-900 text-white text-sm font-medium rounded-md hover:bg-zinc-800 disabled:opacity-50"
                >
                  {customLoading ? 'Adding...' : 'Add Niche'}
                </button>
              </form>
            </div>

            {/* Existing Niches Table */}
            <div className="bg-white rounded-lg border border-zinc-200 shadow-sm overflow-hidden">
              <div className="p-4 border-b border-zinc-200">
                <h2 className="text-lg font-semibold">All Niches ({initialNiches.length})</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-zinc-50 border-b border-zinc-200 text-zinc-500 font-medium">
                    <tr>
                      <th className="px-6 py-3">Label</th>
                      <th className="px-6 py-3">City</th>
                      <th className="px-6 py-3">Status</th>
                      <th className="px-6 py-3">Source</th>
                      <th className="px-6 py-3">Reasoning</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-200">
                    {initialNiches.map((niche) => (
                      <tr key={niche.id} className="hover:bg-zinc-50">
                        <td className="px-6 py-4 font-medium text-zinc-900">{niche.label}</td>
                        <td className="px-6 py-4 text-zinc-600">{niche.city}</td>
                        <td className="px-6 py-4">
                          <span
                            className={`inline-flex px-2 py-0.5 rounded text-xs font-medium capitalize ${
                              niche.status === 'active'
                                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                : 'bg-zinc-100 text-zinc-600'
                            }`}
                          >
                            {niche.status}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-zinc-600 capitalize">{niche.source.replace('_', ' ')}</td>
                        <td className="px-6 py-4 text-zinc-500 text-xs">{niche.reasoning || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* Tab 3: Settings */}
        {activeTab === 'settings' && (
          <div className="bg-white p-6 rounded-lg border border-zinc-200 shadow-sm max-w-2xl">
            <h2 className="text-lg font-semibold mb-2">Pipeline Settings</h2>
            <p className="text-sm text-zinc-500 mb-6">Manage global automation limits and pause switches.</p>

            {settingsMessage && (
              <div className="mb-4 p-3 bg-zinc-100 border border-zinc-200 text-zinc-800 text-sm rounded-md">
                {settingsMessage}
              </div>
            )}

            <form onSubmit={handleUpdateSettings} className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1">Daily Send Cap</label>
                <input
                  type="number"
                  min="1"
                  max="100"
                  value={dailyCap}
                  onChange={(e) => setDailyCap(parseInt(e.target.value, 10) || 1)}
                  className="w-full px-3 py-2 text-sm border border-zinc-300 rounded-md focus:outline-none focus:ring-1 focus:ring-zinc-900"
                />
                <p className="text-xs text-zinc-500 mt-1">Hard-capped under Resend's 100/day free ceiling.</p>
              </div>

              <div className="flex items-center justify-between p-4 bg-zinc-50 rounded-lg border border-zinc-200">
                <div>
                  <span className="block text-sm font-medium text-zinc-900">Pause All Sending</span>
                  <span className="block text-xs text-zinc-500">Halts all automated email sending immediately.</span>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={paused}
                    onChange={(e) => setPaused(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-zinc-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-zinc-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-zinc-900"></div>
                </label>
              </div>

              <div className="pt-4 border-t border-zinc-100 flex justify-end">
                <button
                  type="submit"
                  disabled={settingsLoading}
                  className="px-4 py-2 bg-zinc-900 text-white text-sm font-medium rounded-md hover:bg-zinc-800 disabled:opacity-50"
                >
                  {settingsLoading ? 'Saving...' : 'Save Settings'}
                </button>
              </div>
            </form>
          </div>
        )}
      </main>
    </div>
  )
}
