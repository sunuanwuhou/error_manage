// src/components/practice/state-badge.tsx
// 四状态机徽章（§0.6）

import type { QuestionState } from '@/lib/mastery-engine'

interface Props {
  state: QuestionState
  masteryPercent: number
  isHot?: boolean
  size?: 'sm' | 'md'
}

const STATE_CONFIG: Record<QuestionState, { label: string; color: string; bg: string }> = {
  stockified:          { label: '已稳固',    color: 'text-green-700',  bg: 'bg-green-50 border-green-200' },
  increment_candidate: { label: '冲刺目标',  color: 'text-orange-700', bg: 'bg-orange-50 border-orange-200' },
  building:            { label: '攻坚中',    color: 'text-blue-700',   bg: 'bg-blue-50 border-blue-200' },
  skipped:             { label: '本次跳过',  color: 'text-gray-500',   bg: 'bg-gray-50 border-gray-200' },
}

export function StateBadge({ state, masteryPercent, isHot, size = 'sm' }: Props) {
  const cfg = STATE_CONFIG[state]
  const sizeClass = size === 'sm' ? 'text-xs px-2 py-0.5' : 'text-sm px-3 py-1'

  return (
    <div className="flex items-center gap-1.5">
      <span className={`inline-flex items-center gap-1 rounded-full border font-medium ${cfg.color} ${cfg.bg} ${sizeClass}`}>
        {isHot && '🔥 '}
        {cfg.label}
      </span>
      <MasteryBar percent={masteryPercent} state={state} />
    </div>
  )
}

export function MasteryBar({ percent, state }: { percent: number; state: QuestionState }) {
  const colorMap: Record<QuestionState, string> = {
    stockified:          'bg-green-500',
    increment_candidate: 'bg-orange-500',
    building:            'bg-blue-500',
    skipped:             'bg-gray-300',
  }
  return (
    <div className="flex items-center gap-1.5">
      <div className="w-16 h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${colorMap[state]}`}
          style={{ width: `${percent}%` }}
        />
      </div>
      <span className="text-xs text-gray-400 tabular-nums">{percent}%</span>
    </div>
  )
}
