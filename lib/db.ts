import { Pool } from 'pg'
import { attachDatabasePool } from '@vercel/functions'

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
})

// Lets Vercel's runtime close idle connections cleanly between invocations
// instead of leaking them — safe to call once at module load.
attachDatabasePool(pool)
