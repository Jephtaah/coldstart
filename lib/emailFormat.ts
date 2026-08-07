import { SEND_INTERVAL_MS_MIN, SEND_INTERVAL_MS_MAX } from './constants'

export function toHtml(text: string): string {
  const escaped = text
    .replace(/\r\n/g, '\n')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  const paragraphs = escaped.split(/\n\n+/).map((p) => p.replace(/\n/g, '<br>'))
  return paragraphs.map((p) => `<p>${p}</p>`).join('')
}

export function sendDelayMs(): number {
  return Math.floor(
    Math.random() * (SEND_INTERVAL_MS_MAX - SEND_INTERVAL_MS_MIN + 1) + SEND_INTERVAL_MS_MIN
  )
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
