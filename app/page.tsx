import { pool } from '@/lib/db'
import { DEFAULT_INDUSTRIES, DEFAULT_CITIES, MAX_DAILY_CAP } from '@/lib/constants'
import DashboardClient from '@/components/DashboardClient'

export const dynamic = 'force-dynamic'

export default async function Page() {
  const [settingsRes, nichesRes, leadsRes, statsRes, statusCountsRes, errorsRes] = await Promise.all([
    pool.query('select * from settings where id = 1'),
    pool.query('select * from niches order by created_at desc'),
    pool.query('select * from leads order by seo_score asc nulls last, created_at desc'),
    pool.query(`
      select
        coalesce(count(*), 0) as total,
        coalesce(sum(case when status = 'sent' or status = 'followed_up' then 1 else 0 end), 0) as sent_total,
        coalesce(sum(case when initial_opened_at is not null or followup_opened_at is not null then 1 else 0 end), 0) as opened_total,
        coalesce(sum(case when initial_sent_at >= current_date or followup_sent_at >= current_date then 1 else 0 end), 0) as sent_today
      from leads
    `),
    pool.query('select status, count(*)::int as count from leads group by status'),
    pool.query('select * from errors order by created_at desc limit 200'),
  ])

  const settings = settingsRes.rows[0] || { daily_cap: MAX_DAILY_CAP, paused: false, last_run_at: null }
  const niches = nichesRes.rows
  const leads = leadsRes.rows
  const errors = errorsRes.rows
  const rawStats = statsRes.rows[0] || { total: 0, sent_total: 0, opened_total: 0, sent_today: 0 }
  const stats = {
    total: Number(rawStats.total) || 0,
    sent_total: Number(rawStats.sent_total) || 0,
    opened_total: Number(rawStats.opened_total) || 0,
    sent_today: Number(rawStats.sent_today) || 0,
  }
  const statusCounts = statusCountsRes.rows.reduce(
    (acc, row) => {
      acc[row.status] = Number(row.count) || 0
      return acc
    },
    {} as Record<string, number>
  )

  return (
    <DashboardClient
      initialSettings={settings}
      initialNiches={niches}
      initialLeads={leads}
      initialErrors={errors}
      stats={stats}
      statusCounts={statusCounts}
      defaultIndustries={DEFAULT_INDUSTRIES}
      defaultCities={DEFAULT_CITIES}
    />
  )
}
