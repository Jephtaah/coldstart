export const MIN_SEO_SCORE = 0
export const MAX_SEO_SCORE = 100
export const DEFAULT_SEO_SCORE = 50
export const SITE_WEIGHT = 0.6
export const DISCOVERY_WEIGHT = 0.4

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

function ratingBucket(rating: number | null): number {
  if (rating === null) return 50
  if (rating < 3.5) return 55
  if (rating < 4.2) return 70
  if (rating < 4.7) return 85
  return 90
}

function reviewBucket(count: number | null): number {
  if (count === null) return 45
  if (count === 0) return 40
  if (count <= 5) return 50
  if (count <= 20) return 62
  if (count <= 50) return 75
  if (count <= 150) return 85
  return 95
}

function pageBucket(pageIndex: number): number {
  if (pageIndex <= 0) return 85
  if (pageIndex === 1) return 70
  return 55
}

export function scoreDiscoverySignals(signals: DiscoverySignals): SeoResult {
  const flags: string[] = []
  if (!signals.hasWebsite) flags.push('no_website')
  if (signals.userRatingCount !== null && signals.userRatingCount <= 5) flags.push('low_review_count')
  if (signals.pageIndex > 0) flags.push(`deep_result_page_${signals.pageIndex + 1}`)

  const ratingScore = ratingBucket(signals.rating)
  const reviewScore = reviewBucket(signals.userRatingCount)
  const pageScore = pageBucket(signals.pageIndex)

  const score = 0.5 * reviewScore + 0.25 * ratingScore + 0.25 * pageScore
  return { score: clampScore(score), flags }
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
