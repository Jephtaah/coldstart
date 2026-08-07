export const MIN_SEO_SCORE = 0
export const MAX_SEO_SCORE = 100
export const DEFAULT_SEO_SCORE = 50
export const SITE_WEIGHT = 0.6
export const DISCOVERY_WEIGHT = 0.4
export const NO_WEBSITE_PENALTY = 35

export interface DiscoverySignals {
  hasWebsite: boolean
  userRatingCount: number | null
  rating: number | null
  pageIndex: number
}

export interface SiteSignals {
  title: string
  metaDescription: string
  hasViewport: boolean
  h1Count: number
  bodyWordCount: number
}

export interface SeoResult {
  score: number
  flags: string[]
}

function clampScore(value: number): number {
  return Math.max(MIN_SEO_SCORE, Math.min(MAX_SEO_SCORE, Math.round(value)))
}

function pagePenalty(pageIndex: number): number {
  if (pageIndex <= 0) return 0
  if (pageIndex === 1) return 15
  if (pageIndex === 2) return 40
  if (pageIndex === 3) return 55
  return 65
}

function reviewPenalty(count: number | null): number {
  if (count === null) return 25
  if (count === 0) return 30
  if (count <= 5) return 20
  if (count <= 20) return 12
  if (count <= 50) return 6
  if (count <= 150) return 2
  return 0
}

function ratingPenalty(rating: number | null): number {
  if (rating === null) return 15
  if (rating < 3.5) return 15
  if (rating < 4.2) return 8
  if (rating < 4.7) return 3
  return 0
}

export function scoreDiscoverySignals(signals: DiscoverySignals): SeoResult {
  const flags: string[] = []
  if (!signals.hasWebsite) flags.push('no_website')
  if (signals.userRatingCount !== null && signals.userRatingCount <= 5) flags.push('low_review_count')
  if (signals.pageIndex > 0) flags.push(`deep_result_page_${signals.pageIndex + 1}`)

  let weakness = pagePenalty(signals.pageIndex)
  weakness += reviewPenalty(signals.userRatingCount)
  weakness += ratingPenalty(signals.rating)
  if (!signals.hasWebsite) weakness += NO_WEBSITE_PENALTY

  return { score: clampScore(MAX_SEO_SCORE - weakness), flags }
}

export function scoreSiteSignals(signals: SiteSignals): SeoResult {
  let score = MAX_SEO_SCORE
  const flags: string[] = []

  if (!signals.title.trim()) {
    score -= 20
    flags.push('no_title')
  }
  if (!signals.metaDescription.trim()) {
    score -= 20
    flags.push('no_meta_description')
  }
  if (!signals.hasViewport) {
    score -= 25
    flags.push('no_viewport')
  }
  if (signals.h1Count < 1) {
    score -= 15
    flags.push('no_h1')
  }
  if (signals.bodyWordCount < 100) {
    score -= 15
    flags.push('thin_content')
  } else if (signals.bodyWordCount < 250) {
    score -= 10
    flags.push('thin_content')
  }

  return { score: clampScore(score), flags }
}

export function mergeSeoScores(discoveryScore: number, siteScore: number | null): number {
  if (siteScore === null) return clampScore(discoveryScore)
  return clampScore(SITE_WEIGHT * siteScore + DISCOVERY_WEIGHT * discoveryScore)
}
