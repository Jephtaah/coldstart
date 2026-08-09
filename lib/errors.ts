import { pool } from './db'

// Error records persisted by the pipeline and discovery routes so the operator
// can inspect failures on the dashboard instead of receiving alert emails.

export interface ErrorRecord {
  id: string
  source: 'pipeline' | 'discover'
  stage: string
  message: string
  context: unknown | null
  created_at: string
}

export interface RecordErrorParams {
  source: ErrorRecord['source']
  stage: string
  message: string
  context?: unknown
}

// Persists a stage failure to the errors table. Returns whether the insert
// succeeded so callers can surface a broken error-reporting path instead of
// silently losing audit records. A failure here never throws into the calling
// stage; it is logged and reflected in the return value.
export async function recordError(params: RecordErrorParams): Promise<boolean> {
  const { source, stage, message, context } = params
  try {
    await pool.query(
      `INSERT INTO errors (source, stage, message, context) VALUES ($1, $2, $3, $4)`,
      [source, stage, message, context === undefined ? null : JSON.stringify(context)]
    )
    return true
  } catch (err: unknown) {
    const recordErr = err instanceof Error ? err.message : String(err)
    console.error(`Failed to record ${source}/${stage} error in errors table:`, recordErr)
    return false
  }
}
