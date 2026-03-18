'use client'
// src/app/(app)/notes/page.tsx — 笔记 + 规律固化（B3+B4）

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { format } from 'date-fns'

type Tab = 'notes' | 'insights'

const INSIGHT_TYPES = [
  { value: 'rule',    label: '做题规则', color: 'bg-blue-100 text-blue-700' },
  { value: 'trap',    label: '易错陷阱', color: 'bg-red-100 text-red-700' },
  { value: 'formula', label: '公式记忆', color: 'bg-purple-100 text-purple-700' },
]
const QUESTION_TYPES = ['判断推理','言语理解','数量关系','资料分析','常识判断']

export default function NotesPage() {
  const router = useRouter()
  const [tab, setTab]     = useState<Tab>('notes')
  const [notes, setNotes] = useState<any[]>([])
  const [insights, setInsights] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editItem, setEditItem] = useState<any>(null)

  function loadData() {
    setLoading(true)
    Promise.all([
      fetch('/api/notes').then(r => r.json()),
      fetch('/api/insights').then(r => r.json()),
    ]).then(([n, i]) => { setNotes(n); setInsights(i); setLoading(false) })
  }

  useEffect(() => { loadData() }, [])

  async function deleteNote(id: string) {
    if (!confirm('删除这条笔记？')) return
    await fetch(`/api/notes?id=${id}`, { method: 'DELETE' })
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

      {loading ? (
        <div className="space-y-3">{[1,2,3].map(i => <div key={i} className="h-20 bg-gray-100 rounded-2xl animate-pulse" />)}</div>
      ) : tab === 'notes' ? (
        notes.length === 0 ? (
          <div className="text-center py-12 text-gray-400"><p className="text-4xl mb-2">📝</p><p>还没有笔记</p></div>
        ) : (
          <div className="space-y-3">
            {notes.map(n => (
              <div key={n.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
                <div className="flex items-start justify-between gap-2 mb-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-lg">{n.type}</span>
                    {n.isPrivate && <span className="text-xs text-gray-400">🔒</span>}
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => { setEditItem(n); setShowForm(true) }} className="text-xs text-blue-500">编辑</button>
                    <button onClick={() => deleteNote(n.id)} className="text-xs text-red-400">删除</button>
                  </div>
                </div>
                <p className="font-medium text-gray-900 text-sm">{n.title}</p>
                <p className="text-xs text-gray-500 mt-1 line-clamp-2">{n.content}</p>
                <p className="text-xs text-gray-300 mt-2">{format(new Date(n.updatedAt), 'MM-dd HH:mm')}</p>
              </div>
            ))}
          </div>
        )
      ) : (
        insights.length === 0 ? (
          <div className="text-center py-12 text-gray-400"><p className="text-4xl mb-2">🧠</p><p>还没有固化规律</p><p className="text-xs mt-1">积累做题规律，AI出变式题时会用到</p></div>
        ) : (
          <div className="space-y-3">
            {insights.map(ins => {
              const typeConfig = INSIGHT_TYPES.find(t => t.value === ins.insightType)
              return (
                <div key={ins.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${typeConfig?.color ?? 'bg-gray-100 text-gray-500'}`}>
                      {typeConfig?.label}
                    </span>
                    <span className="text-xs text-gray-500">{ins.skillTag}</span>
                  </div>
                  <p className="text-sm text-gray-800 font-medium">{ins.finalContent}</p>
                  {ins.aiDraft && ins.aiDraft !== ins.finalContent && (
                    <p className="text-xs text-gray-400 mt-1 line-clamp-1">AI草稿：{ins.aiDraft}</p>
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
          onClose={() => { setShowForm(false); setEditItem(null); loadData() }}
        />
      )}
    </div>
  )
}

function NoteInsightForm({ tab, editItem, onClose }: { tab: Tab; editItem: any; onClose: () => void }) {
  const [type, setType]     = useState<Tab>(tab)
  const [saving, setSaving] = useState(false)
  const [form, setForm]     = useState({
    // Note fields
    noteType: editItem?.type ?? '判断推理',
    title:    editItem?.title ?? '',
    content:  editItem?.content ?? '',
    isPrivate: editItem?.isPrivate ?? false,
    // Insight fields
    skillTag:     editItem?.skillTag ?? '判断推理',
    insightType:  editItem?.insightType ?? 'rule',
    finalContent: editItem?.finalContent ?? '',
    aiDraft:      editItem?.aiDraft ?? '',
  })

  async function handleSave() {
    setSaving(true)
    if (type === 'notes') {
      const method = editItem ? 'PATCH' : 'POST'
      const body   = editItem
        ? { id: editItem.id, title: form.title, content: form.content, isPrivate: form.isPrivate }
        : { type: form.noteType, title: form.title, content: form.content, isPrivate: form.isPrivate }
      await fetch('/api/notes', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    } else {
      const method = editItem ? 'PATCH' : 'POST'
      const body   = editItem
        ? { id: editItem.id, finalContent: form.finalContent }
        : { skillTag: form.skillTag, insightType: form.insightType, finalContent: form.finalContent, aiDraft: form.aiDraft }
      await fetch('/api/insights', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    }
    setSaving(false)
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
