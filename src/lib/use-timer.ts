// src/lib/use-timer.ts
'use client'
// 静默计时 Hook（§5.1 步骤2）
// 只记录用时，不倒计时，不制造焦虑
// 超速度警戒线后变色提示

import { useRef, useState, useEffect, useCallback } from 'react'
import { SPEED_LIMITS } from './mastery-engine'

export function useTimer(questionType: string) {
  const startRef  = useRef<number>(Date.now())
  const [elapsed, setElapsed] = useState(0)
  const intervalRef = useRef<NodeJS.Timeout | null>(null)

  const limit = SPEED_LIMITS[questionType] ?? 90

  const start = useCallback(() => {
    startRef.current = Date.now()
    setElapsed(0)
    if (intervalRef.current) clearInterval(intervalRef.current)
    intervalRef.current = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startRef.current) / 1000))
    }, 1000)
  }, [])

  const stop = useCallback(() => {
    if (intervalRef.current) clearInterval(intervalRef.current)
    return Math.floor((Date.now() - startRef.current) / 1000)
  }, [])

  useEffect(() => () => { if (intervalRef.current) clearInterval(intervalRef.current) }, [])

  const isOverLimit = elapsed > limit
  const isSlow      = elapsed > limit  // 超警戒线

  return { elapsed, isOverLimit, isSlow, limit, start, stop }
}

export function formatTime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}
