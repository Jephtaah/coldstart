import {
  DEEPSEEK_API_URL,
  DEEPSEEK_MODEL,
  DEEPSEEK_TEMPERATURE,
  AI_TIMEOUT_MS,
  MAX_AI_ATTEMPTS,
} from './constants'

// Single shared DeepSeek client used by email generation, follow-up writing,
// and niche expansion. Every caller supplies a `parse` function that turns the
// raw JSON response into its own shape; retries on network errors, timeouts,
// and unparseable/mismatched responses are handled once here.

// Returns the configured DeepSeek API key, or null when unset. Exported so
// callers can fail fast on a missing key without generating (and failing)
// work that would throw on the first AI call anyway.
export function getAiApiKey(): string | null {
  return process.env.DEEPSEEK_API_KEY || process.env.AI_API_KEY || null
}

// Thrown when the AI provider is unreachable, rate-limited, or misconfigured
// (e.g. an invalid key). This is a systemic problem, not a fault of the lead
// being processed: callers should surface it (record it, fail the run) and
// leave work queued for a retry instead of permanently failing leads.
export class AiUnavailableError extends Error {}

// Calls DeepSeek with the given prompts and returns the parsed result. Throws:
// - a plain Error when the API key is missing (config the operator must fix), or
// - AiUnavailableError immediately for 401/403 (key/billing config), and after
//   all retries are exhausted for network errors, timeouts, and responses that
//   don't parse or don't match the expected shape.
// Callers never see a silent `null` that would be mistaken for "no result".
export async function callDeepSeekJson<T>(
  systemPrompt: string,
  userMessage: string,
  parse: (value: unknown) => T | null
): Promise<T> {
  const apiKey = getAiApiKey()
  if (!apiKey) {
    throw new Error('DEEPSEEK_API_KEY or AI_API_KEY is not set in environment variables.')
  }

  let lastError = `No usable response after ${MAX_AI_ATTEMPTS} attempts`

  for (let attempt = 0; attempt < MAX_AI_ATTEMPTS; attempt++) {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), AI_TIMEOUT_MS)
    try {
      const res = await fetch(DEEPSEEK_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: DEEPSEEK_MODEL,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMessage },
          ],
          temperature: DEEPSEEK_TEMPERATURE,
        }),
        signal: controller.signal,
      })

      // 401/403 are config problems (invalid key, billing/access) that won't
      // self-resolve on retry. Fail fast so the operator is alerted instead of
      // every lead silently failing after two identical attempts.
      if (res.status === 401 || res.status === 403) {
        throw new AiUnavailableError(
          `DeepSeek API auth/config error (${res.status}): ${await res.text()}`
        )
      }
      if (!res.ok) {
        throw new Error(`DeepSeek API error: ${res.status} ${await res.text()}`)
      }

      const data = await res.json()
      let content = data.choices?.[0]?.message?.content
      if (!content) throw new Error('Empty response from DeepSeek API')

      // Strip markdown code fences if present.
      content = content
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/i, '')
        .replace(/\s*```$/, '')
        .trim()

      const parsed = JSON.parse(content)
      const result = parse(parsed)
      if (result !== null) return result
      lastError = 'Response did not match the expected format'
    } catch (err) {
      // Config errors are not retried.
      if (err instanceof AiUnavailableError) throw err
      // Network error, timeout, or unparseable/mismatched response — retry.
      lastError = err instanceof Error ? err.message : String(err)
    } finally {
      clearTimeout(timeoutId)
    }
  }

  throw new AiUnavailableError(lastError)
}

export interface AiEmailContent {
  subject: string
  body: string
}

// Shared validator for email-generation responses ({ subject, body }).
export function parseEmailResponse(value: unknown): AiEmailContent | null {
  if (typeof value !== 'object' || value === null) return null
  const obj = value as Record<string, unknown>
  if (typeof obj.subject === 'string' && typeof obj.body === 'string') {
    return { subject: obj.subject, body: obj.body }
  }
  return null
}
