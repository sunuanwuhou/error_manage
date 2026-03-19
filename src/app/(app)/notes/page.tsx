'use client'
// src/app/(app)/notes/page.tsx — 笔记 + 规律固化（B3+B4）

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { format } from 'date-fns'

type Tab = 'notes' | 'insights'

const INSIGHT_TYPES = [
  { value: 'rule',    label: '做题规则', color: 'bg-blue-100 text-blue-700' },
  { value: 'trap',    label: '易错陷阱', color: 'bg-red-100 text-red-700' },
  { value: 'formula', label: '公式记忆', color: 'bg-purple-100 text-purple-700' },
]
const NOTE_SOURCE_OPTIONS = ['通用', '错题复盘', '套卷总结', 'AI 草稿', '临考提醒']
const QUESTION_TYPES = ['判断推理','言语理解','数量关系','资料分析','常识判断']

function normalizeText(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function buildInsightSourceLabel(ins: any) {
  const sourceIds = normalizeText(ins.sourceErrorIds)
  const examples = normalizeText(ins.domainExamples)
  if (sourceIds && examples) return '来源完整'
  if (sourceIds) return '有来源题目'
  if (examples) return '有典型例子'
  return '未补来源'
}

export default function NotesPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [tab, setTab]     = useState<Tab>('notes')
  const [notes, setNotes] = useState<any[]>([])
  const [insights, setInsights] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [notesError, setNotesError] = useState('')
  const [insightsError, setInsightsError] = useState('')
  const [searchText, setSearchText] = useState('')
  const [noteTypeFilter, setNoteTypeFilter] = useState('全部')
  const [noteSourceFilter, setNoteSourceFilter] = useState('全部')
  const [insightTypeFilter, setInsightTypeFilter] = useState('全部')
  const [insightSourceFilter, setInsightSourceFilter] = useState('全部')
  const [showForm, setShowForm] = useState(false)
  const [editItem, setEditItem] = useState<any>(null)
  const [draftItem, setDraftItem] = useState<any>(null)
  const [message, setMessage] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)

  function loadData() {
    setLoading(true)
    setNotesError('')
    setInsightsError('')
    Promise.allSettled([
      fetch('/api/notes').then(async r => {
        const data = await r.json()
        if (!r.ok) throw new Error(data.error ?? '笔记加载失败')
        return data
      }),
      fetch('/api/insights').then(async r => {
        const data = await r.json()
        if (!r.ok) throw new Error(data.error ?? '规律加载失败')
        return data
      }),
    ]).then(([notesResult, insightsResult]) => {
      if (notesResult.status === 'fulfilled') {
        setNotes(notesResult.value)
      } else {
        setNotes([])
        setNotesError(notesResult.reason?.message ?? '笔记加载失败')
      }

      if (insightsResult.status === 'fulfilled') {
        setInsights(insightsResult.value)
      } else {
        setInsights([])
        setInsightsError(insightsResult.reason?.message ?? '规律加载失败')
      }

      if (notesResult.status === 'rejected' || insightsResult.status === 'rejected') {
        setMessage({ type: 'err', text: '部分内容加载失败，但你仍可以继续使用另一部分。' })
      }
      setLoading(false)
    })
  }

  useEffect(() => { loadData() }, [])

  useEffect(() => {
    const draft = searchParams.get('draft')
    if (draft !== '1') return

    const draftKind = searchParams.get('draftKind') === 'insights' ? 'insights' : 'notes'
    setTab(draftKind)
    setEditItem(null)
    setDraftItem({
      type: searchParams.get('draftType') ?? undefined,
      subtype: searchParams.get('draftSubtype') ?? undefined,
      title: searchParams.get('draftTitle') ?? '',
      content: searchParams.get('draftContent') ?? '',
      isPrivate: searchParams.get('draftPrivate') === '1',
      skillTag: searchParams.get('draftSkillTag') ?? '',
      insightType: searchParams.get('draftInsightType') ?? undefined,
      finalContent: searchParams.get('draftFinalContent') ?? '',
      aiDraft: searchParams.get('draftAiDraft') ?? '',
      sourceErrorIds: searchParams.get('draftSourceErrorIds') ?? '',
      domainExamples: searchParams.get('draftDomainExamples') ?? '',
    })
    setShowForm(true)
    router.replace('/notes', { scroll: false })
  }, [router, searchParams])

  const normalizedSearch = searchText.trim().toLowerCase()
  const filteredNotes = notes.filter(n => {
    const matchesType = noteTypeFilter === '全部' || n.type === noteTypeFilter
    if (!matchesType) return false
    const noteSource = normalizeText(n.subtype) || '通用'
    if (noteSourceFilter !== '全部' && noteSource !== noteSourceFilter) return false
    if (!normalizedSearch) return true
    return [n.title, n.content, n.type, n.subtype]
      .filter(Boolean)
      .some((value: string) => value.toLowerCase().includes(normalizedSearch))
  })
  const filteredInsights = insights.filter(ins => {
    const matchesType = insightTypeFilter === '全部' || ins.insightType === insightTypeFilter
    if (!matchesType) return false
    if (insightSourceFilter !== '全部' && buildInsightSourceLabel(ins) !== insightSourceFilter) return false
    if (!normalizedSearch) return true
    return [ins.skillTag, ins.finalContent, ins.aiDraft, ins.insightType, ins.sourceErrorIds, ins.domainExamples]
      .filter(Boolean)
      .some((value: string) => value.toLowerCase().includes(normalizedSearch))
  })

  async function deleteNote(id: string) {
    if (!confirm('删除这条笔记？')) return
    const res = await fetch(`/api/notes?id=${id}`, { method: 'DELETE' })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setMessage({ type: 'err', text: data.error ?? '删除失败' })
      return
    }
    setMessage({ type: 'ok', text: '删除成功' })
    loadData()
  }

  async function deleteInsight(id: string) {
    if (!confirm('删除这条规律？')) return
    const res = await fetch(`/api/insights?id=${id}`, { method: 'DELETE' })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setMessage({ type: 'err', text: data.error ?? '删除失败' })
      return
    }
    setMessage({ type: 'ok', text: '删除成功' })
    loadData()
  }

  return (
    <div className="max-w-lg mx-auto px-4 pt-4 pb-8">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold text-gray-900">笔记 & 规律</h1>
        <button onClick={() => { setEditItem(null); setShowForm(true) }}
          className="bg-blue-600 text-white text-sm px-4 py-2 rounded-xl font-medium min-h-[44px] flex items-center">
          + 新增
        </button>
      </div>

      {message && (
        <div className={`mb-4 rounded-xl px-4 py-3 text-sm ${message.type === 'ok' ? 'bg-green-50 text-green-600 border border-green-200' : 'bg-red-50 text-red-600 border border-red-200'}`}>
          {message.text}
        </div>
      )}

      {/* Tab */}
      <div className="flex gap-2 mb-4">
        {[{ key: 'notes', label: `笔记 ${notes.length}` }, { key: 'insights', label: `规律 ${insights.length}` }].map(t => (
          <button key={t.key} onClick={() => setTab(t.key as Tab)}
            className={`flex-1 py-2 rounded-xl text-sm font-medium border transition-colors
              ${tab === t.key ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-200'}`}>
            {t.label}
          </button>
        ))}
      </div>

      <div className="mb-4 space-y-3 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
        <div className="grid gap-3 sm:grid-cols-[1fr_180px]">
          <input
            value={searchText}
            onChange={e => setSearchText(e.target.value)}
            placeholder={tab === 'notes' ? '搜索标题、内容、题型、来源' : '搜索考点、规律内容、来源'}
            className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
          />
          {tab === 'notes' ? (
            <div className="grid grid-cols-2 gap-3">
              <select
                value={noteTypeFilter}
                onChange={e => setNoteTypeFilter(e.target.value)}
                className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              >
                {['全部', ...QUESTION_TYPES].map(type => <option key={type}>{type}</option>)}
              </select>
              <select
                value={noteSourceFilter}
                onChange={e => setNoteSourceFilter(e.target.value)}
                className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              >
                {['全部', ...NOTE_SOURCE_OPTIONS].map(type => <option key={type}>{type}</option>)}
              </select>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <select
                value={insightTypeFilter}
                onChange={e => setInsightTypeFilter(e.target.value)}
                className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              >
                {['全部', ...INSIGHT_TYPES.map(item => item.value)].map(type => (
                  <option key={type} value={type}>
                    {type === '全部' ? type : INSIGHT_TYPES.find(item => item.value === type)?.label ?? type}
                  </option>
                ))}
              </select>
              <select
                value={insightSourceFilter}
                onChange={e => setInsightSourceFilter(e.target.value)}
                className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              >
                {['全部', '来源完整', '有来源题目', '有典型例子', '未补来源'].map(type => (
                  <option key={type}>{type}</option>
                ))}
              </select>
            </div>
          )}
        </div>
        <p className="text-xs text-gray-400">
          {tab === 'notes'
            ? `共 ${notes.length} 条笔记，当前显示 ${filteredNotes.length} 条`
            : `共 ${insights.length} 条规律，当前显示 ${filteredInsights.length} 条`}
        </p>
      </div>

      <div className="mb-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
          <p className="text-xs text-gray-400 mb-2">笔记来源分布</p>
          <div className="flex flex-wrap gap-2">
            {NOTE_SOURCE_OPTIONS.map(source => {
              const count = notes.filter(n => (normalizeText(n.subtype) || '通用') === source).length
              return (
                <span key={source} className="rounded-full bg-gray-50 px-3 py-1 text-xs text-gray-600">
                  {source} {count}
                </span>
              )
            })}
          </div>
        </div>
        <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
          <p className="text-xs text-gray-400 mb-2">规律来源完整度</p>
          <div className="flex flex-wrap gap-2">
            {['来源完整', '有来源题目', '有典型例子', '未补来源'].map(label => {
              const count = insights.filter(ins => buildInsightSourceLabel(ins) === label).length
              return (
                <span key={label} className="rounded-full bg-gray-50 px-3 py-1 text-xs text-gray-600">
                  {label} {count}
                </span>
              )
            })}
          </div>
        </div>
      </div>

      {loading ? (
        <div className="space-y-3">{[1,2,3].map(i => <div key={i} className="h-20 bg-gray-100 rounded-2xl animate-pulse" />)}</div>
      ) : tab === 'notes' ? (
        notesError ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-600">
            {notesError}
          </div>
        ) :
        filteredNotes.length === 0 ? (
          <div className="text-center py-12 text-gray-400"><p className="text-4xl mb-2">📝</p><p>还没有笔记</p></div>
        ) : (
          <div className="space-y-3">
            {filteredNotes.map(n => (
              <div key={n.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
                <div className="flex items-start justify-between gap-2 mb-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-lg">{n.type}</span>
                    <span className="text-xs bg-blue-50 text-blue-600 px-2 py-0.5 rounded-lg">{normalizeText(n.subtype) || '通用'}</span>
                    {n.isPrivate && <span className="text-xs text-gray-400">🔒</span>}
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => { setEditItem(n); setShowForm(true) }} className="text-xs text-blue-500">编辑</button>
                    <button onClick={() => deleteNote(n.id)} className="text-xs text-red-400">删除</button>
                  </div>
                </div>
                <p className="font-medium text-gray-900 text-sm">{n.title}</p>
                <p className="text-xs text-gray-500 mt-1 line-clamp-2">{n.content}</p>
                <div className="mt-2 flex items-center justify-between gap-3 text-xs text-gray-300">
                  <p>{format(new Date(n.updatedAt), 'MM-dd HH:mm')}</p>
                  <p>{n.isPrivate ? '仅自己可见' : '可用于整理复盘'}</p>
                </div>
              </div>
            ))}
          </div>
        )
      ) : (
        insightsError ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-600">
            {insightsError}
          </div>
        ) :
        filteredInsights.length === 0 ? (
          <div className="text-center py-12 text-gray-400"><p className="text-4xl mb-2">🧠</p><p>还没有固化规律</p><p className="text-xs mt-1">积累做题规律，AI出变式题时会用到</p></div>
        ) : (
          <div className="space-y-3">
            {filteredInsights.map(ins => {
              const typeConfig = INSIGHT_TYPES.find(t => t.value === ins.insightType)
              return (
                <div key={ins.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
                  <div className="mb-2 flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${typeConfig?.color ?? 'bg-gray-100 text-gray-500'}`}>
                        {typeConfig?.label}
                      </span>
                      <span className="text-xs text-gray-500">{ins.skillTag}</span>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => { setEditItem(ins); setShowForm(true) }} className="text-xs text-blue-500">编辑</button>
                      <button onClick={() => deleteInsight(ins.id)} className="text-xs text-red-400">删除</button>
                    </div>
                  </div>
                  <p className="text-sm text-gray-800 font-medium">{ins.finalContent}</p>
                  {ins.aiDraft && ins.aiDraft !== ins.finalContent && (
                    <p className="text-xs text-gray-400 mt-1 line-clamp-1">AI草稿：{ins.aiDraft}</p>
                  )}
                  <div className="mt-2 flex items-center justify-between gap-3 text-xs text-gray-300">
                    <p>{format(new Date(ins.updatedAt), 'MM-dd HH:mm')}</p>
                    <p>{ins.timesApplied ? `已应用 ${ins.timesApplied} 次` : '等待在练习中验证'}</p>
                  </div>
                  {(normalizeText(ins.sourceErrorIds) || normalizeText(ins.domainExamples)) && (
                    <div className="mt-2 rounded-xl bg-gray-50 p-3 text-xs text-gray-500 space-y-1">
                      {normalizeText(ins.sourceErrorIds) && (
                        <p className="line-clamp-1">来源题目：{ins.sourceErrorIds}</p>
                      )}
                      {normalizeText(ins.domainExamples) && (
                        <p className="line-clamp-1">典型例子：{ins.domainExamples}</p>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )
      )}

      {showForm && (
        <NoteInsightForm
          tab={tab}
          editItem={editItem}
          draftItem={draftItem}
          onClose={() => { setShowForm(false); setEditItem(null); setDraftItem(null); loadData() }}
          onSaved={(text, type) => setMessage({ text, type })}
        />
      )}
    </div>
  )
}

function NoteInsightForm({ tab, editItem, draftItem, onClose, onSaved }: { tab: Tab; editItem: any; draftItem: any; onClose: () => void; onSaved: (text: string, type: 'ok' | 'err') => void }) {
  const [type, setType]     = useState<Tab>(tab)
  const [saving, setSaving] = useState(false)
  const [form, setForm]     = useState({
    // Note fields
    noteType: editItem?.type ?? draftItem?.type ?? '判断推理',
    noteSubtype: normalizeText(editItem?.subtype) || normalizeText(draftItem?.subtype) || '通用',
    title:    editItem?.title ?? draftItem?.title ?? '',
    content:  editItem?.content ?? draftItem?.content ?? '',
    isPrivate: editItem?.isPrivate ?? draftItem?.isPrivate ?? false,
    // Insight fields
    skillTag:     editItem?.skillTag ?? draftItem?.skillTag ?? '判断推理',
    insightType:  editItem?.insightType ?? draftItem?.insightType ?? 'rule',
    finalContent: editItem?.finalContent ?? draftItem?.finalContent ?? '',
    aiDraft:      editItem?.aiDraft ?? draftItem?.aiDraft ?? '',
    sourceErrorIds: normalizeText(editItem?.sourceErrorIds) || normalizeText(draftItem?.sourceErrorIds),
    domainExamples: normalizeText(editItem?.domainExamples) || normalizeText(draftItem?.domainExamples),
  })

  async function handleSave() {
    setSaving(true)
    if (type === 'notes') {
      const method = editItem ? 'PATCH' : 'POST'
      const body   = editItem
        ? { id: editItem.id, title: form.title, content: form.content, subtype: form.noteSubtype, isPrivate: form.isPrivate }
        : { type: form.noteType, title: form.title, content: form.content, subtype: form.noteSubtype, isPrivate: form.isPrivate }
      const res = await fetch('/api/notes', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        onSaved(data.error ?? '保存失败', 'err')
        setSaving(false)
        return
      }
      const data = await res.json().catch(() => ({}))
      if (data?.deduped) {
        setSaving(false)
        onSaved('已存在同知识点笔记，未重复创建', 'ok')
        onClose()
        return
      }
    } else {
      const method = editItem ? 'PATCH' : 'POST'
      const body   = editItem
        ? { id: editItem.id, skillTag: form.skillTag, insightType: form.insightType, finalContent: form.finalContent, aiDraft: form.aiDraft, sourceErrorIds: form.sourceErrorIds, domainExamples: form.domainExamples }
        : { skillTag: form.skillTag, insightType: form.insightType, finalContent: form.finalContent, aiDraft: form.aiDraft, sourceErrorIds: form.sourceErrorIds, domainExamples: form.domainExamples }
      const res = await fetch('/api/insights', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        onSaved(data.error ?? '保存失败', 'err')
        setSaving(false)
        return
      }
      const data = await res.json().catch(() => ({}))
      if (data?.deduped) {
        setSaving(false)
        onSaved('已存在同知识点规律，未重复创建', 'ok')
        onClose()
        return
      }
    }
    setSaving(false)
    onSaved(editItem ? '更新成功' : '保存成功', 'ok')
    onClose()
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50">
      <div className="bg-white rounded-t-3xl sm:rounded-2xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-lg text-gray-900">{editItem ? '编辑' : '新增'}</h3>
          <button onClick={onClose} className="text-gray-400 text-2xl">×</button>
        </div>

        {!editItem && (
          <div className="flex gap-2 mb-4">
            {[{ key: 'notes', label: '笔记' }, { key: 'insights', label: '规律' }].map(t => (
              <button key={t.key} onClick={() => setType(t.key as Tab)}
                className={`flex-1 py-2 rounded-xl text-sm font-medium border
                  ${type === t.key ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-200'}`}>
                {t.label}
              </button>
            ))}
          </div>
        )}

        <div className="space-y-3">
          {type === 'notes' ? (<>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">题型</label>
                <select value={form.noteType} onChange={e => setForm(f => ({ ...f, noteType: e.target.value }))}
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-400">
                  {QUESTION_TYPES.map(t => <option key={t}>{t}</option>)}
                </select>
              </div>
              <div className="flex items-end pb-1">
                <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
                  <input type="checkbox" checked={form.isPrivate} onChange={e => setForm(f => ({ ...f, isPrivate: e.target.checked }))} />
                  🔒 私有
                </label>
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">来源</label>
              <select value={form.noteSubtype} onChange={e => setForm(f => ({ ...f, noteSubtype: e.target.value }))}
                className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-400">
                {NOTE_SOURCE_OPTIONS.map(t => <option key={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">标题</label>
              <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">内容（支持 Markdown）</label>
              <textarea value={form.content} onChange={e => setForm(f => ({ ...f, content: e.target.value }))}
                rows={5} className="w-full px-3 py-3 border border-gray-200 rounded-xl text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-400" />
            </div>
          </>) : (<>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">考点</label>
                <input value={form.skillTag} onChange={e => setForm(f => ({ ...f, skillTag: e.target.value }))}
                  placeholder="如：翻译推理"
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">类型</label>
                <select value={form.insightType} onChange={e => setForm(f => ({ ...f, insightType: e.target.value }))}
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-400">
                  {INSIGHT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">来源题目 / 错题ID</label>
              <input value={form.sourceErrorIds} onChange={e => setForm(f => ({ ...f, sourceErrorIds: e.target.value }))}
                placeholder="如：q1,q2,q3"
                className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">典型例子</label>
              <textarea value={form.domainExamples} onChange={e => setForm(f => ({ ...f, domainExamples: e.target.value }))}
                rows={3} placeholder="补一两个能代表这条规律的题目特征"
                className="w-full px-3 py-3 border border-gray-200 rounded-xl text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-400" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">规律内容（人工确认版）</label>
              <textarea value={form.finalContent} onChange={e => setForm(f => ({ ...f, finalContent: e.target.value }))}
                rows={4} placeholder="用自己的话写下这个规律，如：看到'如果...则...'就翻译为充分条件"
                className="w-full px-3 py-3 border border-gray-200 rounded-xl text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-400" />
            </div>
          </>)}
        </div>

        <div className="flex gap-3 mt-4">
          <button onClick={onClose} className="flex-1 py-3 border border-gray-200 text-gray-600 rounded-2xl font-medium">取消</button>
          <button onClick={handleSave} disabled={saving} className="flex-1 py-3 bg-blue-600 text-white rounded-2xl font-bold disabled:opacity-50">
            {saving ? '保存中...' : '保存'}
          </button>
        </div>
      </div>
    </div>
  )
}
