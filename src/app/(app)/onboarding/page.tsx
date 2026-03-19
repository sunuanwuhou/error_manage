'use client'
// src/app/(app)/onboarding/page.tsx
// 首次登录向导（§3.5）：设置考试类型、目标分、考试日期

import { useState } from 'react'
import { useRouter } from 'next/navigation'

const EXAM_TYPES = [
  { value: 'guo_kao',   label: '🏛️ 国考',  hint: '国家公务员考试 · 入围参考≥70分' },
  { value: 'sheng_kao', label: '📋 省考',  hint: '各省公务员考试 · 入围参考≥65分' },
  { value: 'tong_kao',  label: '🤝 统考',  hint: '多省联考 · 入围参考≥68分' },
]

const SCORE_HINTS: Record<string, { pass: number; high: number; top: number }> = {
  guo_kao:   { pass: 70, high: 80, top: 87 },
  sheng_kao: { pass: 65, high: 75, top: 82 },
  tong_kao:  { pass: 68, high: 78, top: 85 },
}

const PROVINCES = [
  '北京','天津','上海','重庆','河北','山西','辽宁','吉林','黑龙江',
  '江苏','浙江','安徽','福建','江西','山东','河南','湖北','湖南',
  '广东','海南','四川','贵州','云南','陕西','甘肃','青海','内蒙古',
  '广西','西藏','宁夏','新疆',
]

export default function OnboardingPage() {
  const router = useRouter()
  const [step, setStep]           = useState(1)
  const [examType, setExamType]   = useState('guo_kao')
  const [province, setProvince]   = useState('')
  const [targetScore, setTarget]  = useState(80)
  const [examDate, setExamDate]   = useState('')
  const [dailyGoal, setDailyGoal] = useState(70)
  const [saving, setSaving]       = useState(false)
  const [saveError, setSaveError] = useState('')

  const hints = SCORE_HINTS[examType]

  async function handleFinish() {
    setSaving(true)
    setSaveError('')
    try {
      const res = await fetch('/api/onboarding', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          examType,
          targetProvince: examType === 'sheng_kao' ? province : undefined,
          targetScore,
          examDate: examDate || undefined,
          dailyGoal,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data.error ?? '保存失败，请稍后重试')
      }
      router.push('/dashboard')
    } catch (error: any) {
      setSaveError(error?.message ?? '保存失败，请稍后重试')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        {/* 进度点 */}
        <div className="flex justify-center gap-2 mb-8">
          {[1, 2, 3].map(i => (
            <div key={i} className={`w-2 h-2 rounded-full transition-colors
              ${i <= step ? 'bg-blue-600' : 'bg-gray-200'}`} />
          ))}
        </div>

        {/* Step 1：考试类型 */}
        {step === 1 && (
          <div>
            <h2 className="text-xl font-bold text-gray-900 mb-1">你参加哪类考试？</h2>
            <p className="text-sm text-gray-500 mb-6">影响题库权重和推题策略</p>
            <div className="space-y-3">
              {EXAM_TYPES.map(t => (
                <button
                  key={t.value}
                  onClick={() => setExamType(t.value)}
                  data-testid={`onboarding-exam-type-${t.value}`}
                  className={`w-full text-left px-4 py-4 rounded-2xl border-2 transition-colors
                    ${examType === t.value
                      ? 'border-blue-500 bg-blue-50'
                      : 'border-gray-100 bg-white hover:border-gray-200'}`}
                >
                  <div className="font-semibold text-gray-900">{t.label}</div>
                  <div className="text-xs text-gray-500 mt-0.5">{t.hint}</div>
                </button>
              ))}
            </div>

            {examType === 'sheng_kao' && (
              <div className="mt-4">
                <label className="block text-sm font-medium text-gray-700 mb-1.5">目标省份</label>
                <select
                  value={province}
                  onChange={e => setProvince(e.target.value)}
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                >
                  <option value="">选择省份（可选）</option>
                  {PROVINCES.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
            )}

            <button
              onClick={() => setStep(2)}
              data-testid="onboarding-step-1-next"
              className="w-full mt-6 py-4 bg-blue-600 text-white font-bold rounded-2xl"
            >
              下一步
            </button>
          </div>
        )}

        {/* Step 2：目标分 + 考试日期 */}
        {step === 2 && (
          <div>
            <h2 className="text-xl font-bold text-gray-900 mb-1">设定目标</h2>
            <p className="text-sm text-gray-500 mb-6">系统会根据目标调整推题优先级</p>

            <div className="mb-5">
              <label className="block text-sm font-medium text-gray-700 mb-3">
                行测目标分：<span className="text-blue-600 font-bold text-lg">{targetScore} 分</span>
              </label>
              <input
                type="range"
                min={50} max={100} step={1}
                value={targetScore}
                onChange={e => setTarget(Number(e.target.value))}
                className="w-full accent-blue-600"
              />
              <div className="flex justify-between text-xs text-gray-400 mt-1">
                <button onClick={() => setTarget(hints.pass)}
                  className={`px-2 py-1 rounded-lg transition-colors ${targetScore === hints.pass ? 'bg-blue-100 text-blue-600' : 'hover:bg-gray-100'}`}>
                  入围线 {hints.pass}
                </button>
                <button onClick={() => setTarget(hints.high)}
                  className={`px-2 py-1 rounded-lg transition-colors ${targetScore === hints.high ? 'bg-blue-100 text-blue-600' : 'hover:bg-gray-100'}`}>
                  高分 {hints.high}
                </button>
                <button onClick={() => setTarget(hints.top)}
                  className={`px-2 py-1 rounded-lg transition-colors ${targetScore === hints.top ? 'bg-blue-100 text-blue-600' : 'hover:bg-gray-100'}`}>
                  进面保底 {hints.top}
                </button>
              </div>
            </div>

            <div className="mb-5">
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                考试日期
                <span className="text-gray-400 font-normal ml-1">（填了才能启用激活期切换）</span>
              </label>
              <input
                type="date"
                value={examDate}
                onChange={e => setExamDate(e.target.value)}
                min={new Date().toISOString().split('T')[0]}
                className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
            </div>

            <div className="flex gap-3">
              <button onClick={() => setStep(1)}
                data-testid="onboarding-step-2-back"
                className="flex-1 py-3 border border-gray-200 text-gray-600 font-medium rounded-2xl">
                上一步
              </button>
              <button
                onClick={() => setStep(3)}
                data-testid="onboarding-step-2-next"
                className="flex-1 py-3 bg-blue-600 text-white font-bold rounded-2xl">
                下一步
              </button>
            </div>
          </div>
        )}

        {/* Step 3：每日目标 + 确认 */}
        {step === 3 && (
          <div>
            <h2 className="text-xl font-bold text-gray-900 mb-1">每日目标题数</h2>
            <p className="text-sm text-gray-500 mb-6">错题复盘优先，剩余名额真题补位</p>

            <div className="grid grid-cols-4 gap-2 mb-6">
              {[30, 50, 70, 100].map(n => (
                <button
                  key={n}
                  onClick={() => setDailyGoal(n)}
                  className={`py-3 rounded-2xl text-sm font-bold border-2 transition-colors
                    ${dailyGoal === n
                      ? 'border-blue-500 bg-blue-50 text-blue-700'
                      : 'border-gray-100 bg-white text-gray-600'}`}
                >
                  {n}
                  {n === 70 && <div className="text-xs font-normal text-gray-400">推荐</div>}
                </button>
              ))}
            </div>

            {/* 确认摘要 */}
            <div className="bg-gray-50 rounded-2xl p-4 mb-6 space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-500">考试类型</span>
                <span className="font-medium">{EXAM_TYPES.find(t => t.value === examType)?.label}</span>
              </div>
              {province && (
                <div className="flex justify-between">
                  <span className="text-gray-500">目标省份</span>
                  <span className="font-medium">{province}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-gray-500">目标分</span>
                <span className="font-medium text-blue-600">{targetScore} 分</span>
              </div>
              {examDate && (
                <div className="flex justify-between">
                  <span className="text-gray-500">考试日期</span>
                  <span className="font-medium">{examDate}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-gray-500">每日目标</span>
                <span className="font-medium">{dailyGoal} 道</span>
              </div>
            </div>

            <div className="flex gap-3">
              <button onClick={() => setStep(2)}
                data-testid="onboarding-step-3-back"
                className="flex-1 py-3 border border-gray-200 text-gray-600 font-medium rounded-2xl">
                上一步
              </button>
              <button
                onClick={handleFinish}
                data-testid="onboarding-submit"
                disabled={saving}
                className="flex-1 py-3 bg-blue-600 text-white font-bold rounded-2xl disabled:opacity-50"
              >
                {saving ? '保存中...' : '开始备考 🚀'}
              </button>
            </div>
            {saveError && (
              <p className="mt-3 text-sm text-red-500">{saveError}</p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
