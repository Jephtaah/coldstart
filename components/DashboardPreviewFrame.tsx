'use client'

import { useLayoutEffect, useRef, useState } from 'react'
import DashboardPreview from '@/components/DashboardPreview'

const DASHBOARD_WIDTH = 1440

export default function DashboardPreviewFrame() {
  const frameRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(0)

  useLayoutEffect(() => {
    const frame = frameRef.current
    if (!frame) return

    const observer = new ResizeObserver(([entry]) => {
      setScale(entry.contentRect.width / DASHBOARD_WIDTH)
    })
    observer.observe(frame)

    return () => observer.disconnect()
  }, [])

  return (
    <div
      ref={frameRef}
      className="relative border border-[#E6E6DF] rounded-2xl overflow-hidden bg-white shadow-[0_24px_60px_-30px_rgba(20,20,19,0.28)] h-[260px] sm:h-[380px] lg:h-[540px]"
    >
      <span className="sr-only">Screenshot of the ColdStart operator dashboard</span>
      <div
        className="w-[1440px] h-[1400px] origin-top-left"
        style={{ transform: `scale(${scale})`, visibility: scale ? 'visible' : 'hidden' }}
        aria-hidden="true"
      >
        <DashboardPreview />
      </div>
    </div>
  )
}
