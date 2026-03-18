'use client'
// src/components/dashboard/alert-cards.tsx

import { useEffect, useState } from 'react'
import Link from 'next/link'

interface Alert {
  type: string
  title: string
  body: string
  action?: string
  actionLabel?: string
  severity: 'info' | 'warn' | 'success'
}

const SEVERITY_STYLES = {
  info:    'bg-blue-50 border-blue-200',
  warn:    'bg-amber-50 border-amber-200',
  success: 'bg-green-50 border-green-200',
}
const SEVERITY_TEXT = {
  info:    'text-blue-700',
  warn:    'text-amber-700',
  success: 'text-green-700',
}

export function AlertCards() {
  const [alerts, setAlerts]     = useState<Alert[]>([])
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())

  useEffect(() => {
    fetch('/api/dashboard/alerts').then(r => r.json()).then(data => {
      if (Array.isArray(data)) setAlerts(data)
    })
  }, [])

  const visible = alerts.filter(a => !dismissed.has(a.type))
  if (visible.length === 0) return null

  return (
    <div className="space-y-3 mb-4">
      {visible.map(alert => (
        <div key={alert.type}
          className={`rounded-2xl border p-4 ${SEVERITY_STYLES[alert.severity]}`}>
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <p className={`font-semibold text-sm ${SEVERITY_TEXT[alert.severity]}`}>
                {alert.title}
              </p>
              <p className={`text-xs mt-0.5 opacity-80 ${SEVERITY_TEXT[alert.severity]}`}>
                {alert.body}
              </p>
              {alert.action && (
                <Link href={alert.action}
                  className={`inline-block mt-2 text-xs font-medium underline ${SEVERITY_TEXT[alert.severity]}`}>
                  {alert.actionLabel ?? '查看'}
                </Link>
              )}
            </div>
            <button onClick={() => setDismissed(s => new Set([...s, alert.type]))}
              className="text-gray-400 hover:text-gray-600 text-lg leading-none flex-shrink-0 mt-0.5">
              ×
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}
