'use client'
// src/components/practice/correction-card.tsx
// 修正卡渐进隐藏（§5.1 步骤1）
// 3阶段：完整 → 只看技能点名称 → 规律自测
// reviewCount 1-2 → 完整；3-4 → 只看标题；5+ → 自测

import { useState } from 'react'

interface CorrectionCardProps {
  skillTag: string           // 考点名称，如"翻译推理"
  aiActionRule?: string      // 下次行动规则（"看到XX就XX"）
  aiThinking?: string        // 正确解题思路
  sharedAiAnalysis?: string  // 公共AI解析
  reviewCount: number        // 已复习次数（决定展示阶段）
}

type CardStage = 'full' | 'title_only' | 'self_test'

function getStage(reviewCount: number): CardStage {
  if (reviewCount <= 2) return 'full'
  if (reviewCount <= 4) return 'title_only'
  return 'self_test'
}

export function CorrectionCard({
  skillTag,
  aiActionRule,
  aiThinking,
  sharedAiAnalysis,
  reviewCount,
}: CorrectionCardProps) {
  const stage = getStage(reviewCount)
  const [expanded, setExpanded] = useState(stage === 'full')

  const analysis = aiThinking || sharedAiAnalysis

  if (stage === 'full') {
    return (
      <div className="rounded-2xl border border-blue-100 bg-blue-50 p-4 space-y-3">
        <div className="flex items-center gap-2">
          <span className="text-blue-600 font-semibold text-sm">📌 修正卡</span>
          <span className="text-xs text-blue-500 bg-blue-100 px-2 py-0.5 rounded-full">{skillTag}</span>
        </div>

        {aiActionRule && (
          <div className="bg-white rounded-xl p-3 border border-blue-100">
            <p className="text-xs text-blue-500 font-medium mb-1">行动规则</p>
            <p className="text-sm text-gray-800">{aiActionRule}</p>
          </div>
        )}

        {analysis && (
          <div className="bg-white rounded-xl p-3 border border-blue-100">
            <p className="text-xs text-blue-500 font-medium mb-1">正确思路</p>
            <p className="text-sm text-gray-700 whitespace-pre-wrap">{analysis}</p>
          </div>
        )}
      </div>
    )
  }

  if (stage === 'title_only') {
    return (
      <div className="rounded-2xl border border-gray-100 bg-gray-50 p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-gray-500 font-medium text-sm">📌 修正卡</span>
            <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">{skillTag}</span>
          </div>
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-xs text-blue-500 underline"
          >
            {expanded ? '收起' : '展开提示'}
          </button>
        </div>

        {expanded && analysis && (
          <div className="mt-3 bg-white rounded-xl p-3 border border-gray-100">
            <p className="text-sm text-gray-700 whitespace-pre-wrap">{analysis}</p>
          </div>
        )}

        {!expanded && (
          <p className="text-xs text-gray-400 mt-1">第 {reviewCount} 次复习 · 试着不看提示</p>
        )}
      </div>
    )
  }

  // self_test stage
  return (
    <div className="rounded-2xl border border-amber-100 bg-amber-50 p-4">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-amber-600 font-medium text-sm">🧪 规律自测</span>
        <span className="text-xs text-amber-500 bg-amber-100 px-2 py-0.5 rounded-full">{skillTag}</span>
      </div>
      <p className="text-xs text-amber-700">
        第 {reviewCount} 次复习 · 先不看提示，自己回忆解题规律
      </p>
      <button
        onClick={() => setExpanded(!expanded)}
        className="mt-2 text-xs text-amber-600 underline"
      >
        {expanded ? '收起提示' : '实在想不起来？看提示'}
      </button>
      {expanded && analysis && (
        <div className="mt-2 bg-white rounded-xl p-3 border border-amber-100">
          <p className="text-sm text-gray-700 whitespace-pre-wrap">{analysis}</p>
        </div>
      )}
    </div>
  )
}
