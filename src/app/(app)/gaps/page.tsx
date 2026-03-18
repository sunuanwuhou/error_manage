'use client'
// src/app/(app)/gaps/page.tsx — 考点盲区完整页

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

interface GapItem {
  skillTag: string; sectionType: string
  freqPct: number; estimatedGain: number; analysisStatus: string | null
}

const SECTION_COLORS: Record<string, string> = {
  '判断推理': 'bg-blue-100 text-blue-700',
  '言语理解': 'bg-green-100 text-green-700',
  '数量关系': 'bg-purple-100 text-purple-700',
  '资料分析': 'bg-orange-100 text-orange-700',
  '常识判断': 'bg-gray-100 text-gray-600',
}

export default function GapsPage() {
  const router = useRouter()
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [queueing, setQueueing] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/analysis/gaps').then(r => r.json()).then(d => { setData(d); setLoading(false) })
  }, [])

  async function addToQueue(skillTag: string) {
    setQueueing(skillTag)
    await fetch('/api/analysis/queue', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'add', targetType: 'skill_tag', targetId: skillTag, priority: 0.8 }),
    })
    // 刷新
    const res = await fetch('/api/analysis/gaps')
    setData(await res.json())
    setQueueing(null)
  }

  if (loading) return (
    <div className="max-w-lg mx-auto px-4 pt-4 space-y-3">
      {[1,2,3,4].map(i => <div key={i} className="h-16 bg-gray-100 rounded-2xl animate-pulse" />)}
    </div>
  )

  return (
    <div className="max-w-lg mx-auto px-4 pt-4 pb-8">
      <div className="flex items-center gap-3 mb-5">
        <button onClick={() => router.back()} className="text-gray-400 text-xl min-h-[44px] min-w-[44px] flex items-center">←</button>
        <div>
          <h1 className="text-xl font-bold text-gray-900">考点盲区</h1>
          <p className="text-xs text-gray-400 mt-0.5">高频考点中从未练过的</p>
        </div>
      </div>

      {data?.message ? (
        <div className="text-center py-12 text-gray-400">
          <p className="text-4xl mb-3">📊</p>
          <p>{data.message}</p>
          <Link href="/import" className="mt-3 inline-block text-blue-500 text-sm underline">去导入真题</Link>
        </div>
      ) : data?.gaps?.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-4xl mb-3">🎉</p>
          <p className="text-gray-600 font-medium">没有考点盲区！</p>
          <p className="text-sm text-gray-400 mt-1">所有高频考点都已接触过</p>
        </div>
      ) : (
        <>
          {/* 汇总 */}
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 mb-5">
            <div className="flex justify-between items-center">
              <div>
                <p className="font-bold text-amber-900">{data.gapCount} 个高频考点盲区</p>
                <p className="text-xs text-amber-700 mt-0.5">已接触 {data.touchedCount} 个考点</p>
              </div>
              {data.totalEstimatedGain > 0 && (
                <div className="text-right">
                  <p className="text-2xl font-bold text-amber-600">+{data.totalEstimatedGain}</p>
                  <p className="text-xs text-amber-500">分 预计提升</p>
                </div>
              )}
            </div>
          </div>

          {/* 按题型分组 */}
          {Object.entries(
            (data.gaps as GapItem[]).reduce((acc: Record<string, GapItem[]>, g) => {
              const k = g.sectionType || '其他'
              if (!acc[k]) acc[k] = []
              acc[k].push(g)
              return acc
            }, {})
          ).map(([section, gaps]) => (
            <div key={section} className="mb-5">
              <div className="flex items-center gap-2 mb-2">
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${SECTION_COLORS[section] ?? 'bg-gray-100 text-gray-600'}`}>
                  {section}
                </span>
                <span className="text-xs text-gray-400">{gaps.length} 个盲区</span>
              </div>
              <div className="space-y-2">
                {(gaps as GapItem[]).map(gap => (
                  <div key={gap.skillTag} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-medium text-gray-900 text-sm">{gap.skillTag}</span>
                          {gap.analysisStatus === 'done' && (
                            <span className="text-xs bg-green-100 text-green-600 px-1.5 py-0.5 rounded-full">已分析</span>
                          )}
                          {gap.analysisStatus === 'pending' && (
                            <span className="text-xs bg-blue-50 text-blue-400 px-1.5 py-0.5 rounded-full">分析中</span>
                          )}
                        </div>
                        <div className="flex items-center gap-3 text-xs text-gray-400">
                          <span>历年出现率 <span className="text-amber-600 font-medium">{gap.freqPct}%</span></span>
                          {gap.estimatedGain > 0 && (
                            <span>补齐预计 <span className="text-green-600 font-medium">+{gap.estimatedGain}分</span></span>
                          )}
                        </div>
                      </div>
                      <div className="flex gap-2 flex-shrink-0">
                        {!gap.analysisStatus && (
                          <button
                            onClick={() => addToQueue(gap.skillTag)}
                            disabled={queueing === gap.skillTag}
                            className="text-xs border border-blue-200 text-blue-500 px-2 py-1.5 rounded-lg hover:bg-blue-50 disabled:opacity-50">
                            {queueing === gap.skillTag ? '...' : '加入分析'}
                          </button>
                        )}
                        <Link href={`/practice?type=${encodeURIComponent(gap.skillTag)}`}
                          className="text-xs bg-blue-600 text-white px-3 py-1.5 rounded-lg font-medium hover:bg-blue-700">
                          去练
                        </Link>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  )
}
