'use client'

import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { buildDraftKey, loadDraft, removeDraft, saveDraft, type NoteDraft } from '@/lib/wrong-workbench-drafts'

export default function WrongNoteEditPage() {
  const searchParams = useSearchParams()
  const wrongId = searchParams.get('wrongId') || ''
  const questionId = searchParams.get('questionId') || ''
  const content = searchParams.get('content') || ''
  const draftKey = useMemo(() => buildDraftKey('note', wrongId, questionId), [wrongId, questionId])

  const [title, setTitle] = useState(`错题笔记 ${wrongId || questionId || ''}`.trim())
  const [noteBody, setNoteBody] = useState('')
  const [anchors, setAnchors] = useState('')
  const [previewOpen, setPreviewOpen] = useState(false)
  const [savedAt, setSavedAt] = useState('')
  const [completed, setCompleted] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const draft = loadDraft<NoteDraft>(draftKey)
    if (draft) {
      setTitle(draft.title || `错题笔记 ${wrongId || questionId || ''}`.trim())
      setAnchors(draft.anchors || '')
      setNoteBody(draft.noteBody || '')
      setSavedAt(draft.updatedAt || '')
    }
  }, [draftKey, wrongId, questionId])

  useEffect(() => {
    fetch(`/api/wrong-questions/workbench/notes?wrongId=${encodeURIComponent(wrongId)}&questionId=${encodeURIComponent(questionId)}`)
      .then(res => res.json())
      .then(data => {
        const item = data?.item
        if (!item) return
        if (item.title) setTitle(item.title)
        if (item.anchors) setAnchors(item.anchors)
        if (item.noteBody) setNoteBody(item.noteBody)
        setCompleted(Boolean(item.completed))
        if (item.updatedAt) setSavedAt(item.updatedAt)
      })
      .catch(() => {})
  }, [wrongId, questionId])

  useEffect(() => {
    const timer = setTimeout(() => {
      const record: NoteDraft = {
        type: 'note',
        key: draftKey,
        wrongId,
        questionId,
        title,
        anchors,
        noteBody,
        updatedAt: new Date().toISOString(),
      }
      saveDraft(record)
      setSavedAt(record.updatedAt)
    }, 500)
    return () => clearTimeout(timer)
  }, [draftKey, wrongId, questionId, title, anchors, noteBody])

  const draft = useMemo(() => ({
    wrongId,
    questionId,
    title,
    anchors,
    noteBody,
    completed,
    source: 'wrong_workbench_note_edit',
  }), [wrongId, questionId, title, anchors, noteBody, completed])

  async function saveToServer(nextCompleted = completed) {
    setSaving(true)
    try {
      const res = await fetch('/api/wrong-questions/workbench/notes', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          wrongId,
          questionId,
          title,
          anchors,
          noteBody,
          completed: nextCompleted,
        }),
      })
      const data = await res.json()
      if (res.ok) {
        setCompleted(Boolean(data?.item?.completed))
        if (data?.item?.updatedAt) setSavedAt(data.item.updatedAt)
      } else {
        alert(data.error || '保存笔记失败')
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <main className="mx-auto max-w-5xl p-6">
      <h1 className="text-2xl font-semibold">错题笔记编辑</h1>

      <section className="mt-6 rounded-2xl border bg-white p-6 shadow-sm">
        <div className="grid gap-4">
          <div className="rounded-xl border bg-slate-50 p-4 text-sm text-slate-600">
            <p>来源 wrongId：{wrongId || '-'}</p>
            <p>来源 questionId：{questionId || '-'}</p>
            <p>草稿状态：{savedAt ? `最近更新时间 ${new Date(savedAt).toLocaleString()}` : '未保存'}</p>
            <p>服务端状态：{completed ? '已完成' : '未完成'}</p>
          </div>

          <input value={title} onChange={e => setTitle(e.target.value)} placeholder="笔记标题" className="rounded-xl border px-3 py-2" />

          <textarea value={content} readOnly rows={4} className="rounded-xl border bg-slate-50 px-3 py-2 text-sm text-slate-600" />

          <input value={anchors} onChange={e => setAnchors(e.target.value)} placeholder="记忆锚点 / 方法标签（用逗号分隔）" className="rounded-xl border px-3 py-2" />

          <textarea
            value={noteBody}
            onChange={e => setNoteBody(e.target.value)}
            rows={12}
            placeholder="写下这道错题为什么错、以后怎么判断、要挂到哪个知识点、下次遇到类似题怎么看。"
            className="rounded-xl border px-3 py-2"
          />

          <div className="flex flex-wrap gap-3">
            <button onClick={() => setPreviewOpen(prev => !prev)} className="rounded-xl border px-4 py-2">
              {previewOpen ? '收起预览' : '预览结构'}
            </button>
            <button onClick={() => { removeDraft(draftKey); setSavedAt('') }} className="rounded-xl border px-4 py-2">清除本地草稿</button>
            <button onClick={() => saveToServer(false)} disabled={saving} className="rounded-xl border px-4 py-2 disabled:opacity-50">
              {saving ? '保存中...' : '保存到工作台'}
            </button>
            <button onClick={() => saveToServer(true)} disabled={saving} className="rounded-xl border px-4 py-2 disabled:opacity-50">保存并标记完成</button>
          </div>

          {previewOpen ? <pre className="overflow-auto rounded-xl bg-slate-50 p-4 text-sm">{JSON.stringify(draft, null, 2)}</pre> : null}
        </div>
      </section>
    </main>
  )
}
