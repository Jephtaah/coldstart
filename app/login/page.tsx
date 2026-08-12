'use client'

import { useState, FormEvent } from 'react'
import { useRouter } from 'next/navigation'

export default function LoginPage() {
  const router = useRouter()
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)

    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    })

    if (!res.ok) {
      const data = await res.json().catch(() => null)
      setError(data?.error ?? 'Incorrect password')
      setSubmitting(false)
      return
    }

    router.replace('/dashboard')
    router.refresh()
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#F8F8F5] text-[#141413] px-4">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-3 mb-8 justify-center">
          <div className="w-9 h-9 rounded-lg bg-[#141413] text-white flex items-center justify-center font-mono font-bold text-sm tracking-tighter shadow-sm shrink-0">
            CS
          </div>
          <h1 className="text-base font-semibold tracking-tight">ColdStart Operator</h1>
        </div>

        <form
          onSubmit={handleSubmit}
          className="bg-white border border-[#E6E6DF] rounded-xl shadow-sm p-6 flex flex-col gap-4"
        >
          <div className="flex flex-col gap-1.5">
            <label htmlFor="password" className="text-xs font-medium text-[#6B6B65]">
              Dashboard password
            </label>
            <input
              id="password"
              type="password"
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="px-3 py-2 text-sm bg-white border border-[#D9D9D3] rounded-md focus:outline-none focus:ring-2 focus:ring-[#141413]/20"
              placeholder="Enter password"
            />
          </div>

          {error && <p className="text-xs text-rose-700">{error}</p>}

          <button
            type="submit"
            disabled={submitting || !password}
            className="px-3 py-2 text-sm font-medium rounded-md bg-[#141413] text-white disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[#2b2b28] transition-colors"
          >
            {submitting ? 'Checking…' : 'Enter'}
          </button>
        </form>
      </div>
    </div>
  )
}
