'use client'
// src/components/gaps/skill-gap-card.tsx
// 考点盲区卡片（§21.3）— 展示在首页和进度页

import { useEffect, useState } from 'react'
import Link from 'next/link'

interface GapItem {
  skillTag:       string
  sectionType:    string
  freqPct:        number
  estimatedGain:  number
  analysisStatus: string | null
}

interface GapData {
  gaps:               GapItem[]
  gapCount:           number
  totalEstimatedGain: number
  message?:           string
}

export function SkillGapCard({ compact = false }: { compact?: boolean }) {
  const [data, setData]     = useState<GapData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/analysis/gaps').then(r => r.json()).then(d => { setData(d); setLoading(false) })
  }, [])

  if (loading) return <div className="h-24 bg-gray-100 rounded-2xl animate-pulse mb-4" />
  if (!data || data.gaps.length === 0) return null

  const topGaps = data.gaps.slice(0, compact ? 3 : 5)

  return (
    <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 mb-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-lg">⚠️</span>
          <span className="font-semibold text-amber-900 text-sm">
            {data.gapCount} 个高频考点从未练过
          </span>
        </div>
        {data.totalEstimatedGain > 0 && (
          <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-medium">
            补齐可 +{data.totalEstimatedGain} 分
          </span>
        )}
      </div>

      <div className="space-y-2">
        {topGaps.map(gap => (
          <div key={gap.skillTag} className="flex items-center gap-3 bg-white rounded-xl px-3 py-2">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-gray-800">{gap.skillTag}</span>
                <span className="text-xs text-gray-400">{gap.sectionType}</span>
                {gap.analysisStatus === 'done' && (
                  <span className="text-xs bg-green-100 text-green-600 px-1.5 py-0.5 rounded-full">已分析</span>
                )}
                {gap.analysisStatus === 'pending' && (
                  <span className="text-xs bg-blue-50 text-blue-400 px-1.5 py-0.5 rounded-full">队列中</span>
                )}
              </div>
              <div className="flex items-center gap-2 mt-0.5">
                <div className="h-1 w-16 bg-gray-100 rounded-full overflow-hidden">
                  <div className="h-full bg-amber-400 rounded-full"
                    style={{ width: `${Math.min(gap.freqPct * 3, 100)}%` }} />
                </div>
                <span className="text-xs text-gray-400">历年出现率 {gap.freqPct}%</span>
              </div>
            </div>
            <Link href={`/practice?type=${encodeURIComponent(gap.skillTag)}`}
              className="flex-shrink-0 text-xs bg-amber-500 text-white px-3 py-1.5 rounded-lg font-medium hover:bg-amber-600 transition-colors">
              去练
            </Link>
          </div>
        ))}
      </div>

      {data.gapCount > (compact ? 3 : 5) && (
        <Link href="/gaps" className="block text-center text-xs text-amber-600 underline mt-2">
          还有 {data.gapCount - topGaps.length} 个盲区 →
        </Link>
      )}
    </div>
  )
}
