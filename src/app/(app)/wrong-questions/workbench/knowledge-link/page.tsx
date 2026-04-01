'use client'

import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { buildDraftKey, loadDraft, removeDraft, saveDraft, type KnowledgeDraft } from '@/lib/wrong-workbench-drafts'

export default function WrongKnowledgeLinkPage() {
  const searchParams = useSearchParams()
  const wrongId = searchParams.get('wrongId') || ''
  const questionId = searchParams.get('questionId') || ''
  const draftKey = useMemo(() => buildDraftKey('knowledge', wrongId, questionId), [wrongId, questionId])

  const [nodeName, setNodeName] = useState('')
  const [moduleName, setModuleName] = useState('')
  const [reason, setReason] = useState('')
  const [previewOpen, setPreviewOpen] = useState(false)
  const [savedAt, setSavedAt] = useState('')
  const [completed, setCompleted] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const draft = loadDraft<KnowledgeDraft>(draftKey)
    if (draft) {
      setModuleName(draft.moduleName || '')
      setNodeName(draft.nodeName || '')
      setReason(draft.reason || '')
      setSavedAt(draft.updatedAt || '')
    }
  }, [draftKey])

  useEffect(() => {
    fetch(`/api/wrong-questions/workbench/knowledge-links?wrongId=${encodeURIComponent(wrongId)}&questionId=${encodeURIComponent(questionId)}`)
      .then(res => res.json())
      .then(data => {
        const item = data?.item
        if (!item) return
        if (item.moduleName) setModuleName(item.moduleName)
        if (item.nodeName) setNodeName(item.nodeName)
        if (item.reason) setReason(item.reason)
        setCompleted(Boolean(item.completed))
        if (item.updatedAt) setSavedAt(item.updatedAt)
      })
      .catch(() => {})
  }, [wrongId, questionId])

  useEffect(() => {
    const timer = setTimeout(() => {
      const record: KnowledgeDraft = {
        type: 'knowledge',
        key: draftKey,
        wrongId,
        questionId,
        moduleName,
        nodeName,
        reason,
        updatedAt: new Date().toISOString(),
      }
      saveDraft(record)
      setSavedAt(record.updatedAt)
    }, 500)
    return () => clearTimeout(timer)
  }, [draftKey, wrongId, questionId, moduleName, nodeName, reason])

  const payload = useMemo(() => ({
    wrongId,
    questionId,
    moduleName,
    nodeName,
    reason,
    completed,
    source: 'wrong_workbench_knowledge_link',
  }), [wrongId, questionId, moduleName, nodeName, reason, completed])

  async function saveToServer(nextCompleted = completed) {
    setSaving(true)
    try {
      const res = await fetch('/api/wrong-questions/workbench/knowledge-links', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          wrongId,
          questionId,
          moduleName,
          nodeName,
          reason,
          completed: nextCompleted,
        }),
      })
      const data = await res.json()
      if (res.ok) {
        setCompleted(Boolean(data?.item?.completed))
        if (data?.item?.updatedAt) setSavedAt(data.item.updatedAt)
      } else {
        alert(data.error || '保存挂接失败')
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <main className="mx-auto max-w-4xl p-6">
      <h1 className="text-2xl font-semibold">挂接知识点</h1>

      <section className="mt-6 rounded-2xl border bg-white p-6 shadow-sm">
        <div className="grid gap-4">
          <div className="rounded-xl border bg-slate-50 p-4 text-sm text-slate-600">
            <p>来源 wrongId：{wrongId || '-'}</p>
            <p>来源 questionId：{questionId || '-'}</p>
            <p>草稿状态：{savedAt ? `最近更新时间 ${new Date(savedAt).toLocaleString()}` : '未保存'}</p>
            <p>服务端状态：{completed ? '已完成' : '未完成'}</p>
          </div>

          <input value={moduleName} onChange={e => setModuleName(e.target.value)} placeholder="模块（例：资料分析 / 判断推理 / 言语理解）" className="rounded-xl border px-3 py-2" />
          <input value={nodeName} onChange={e => setNodeName(e.target.value)} placeholder="知识点 / 节点名称" className="rounded-xl border px-3 py-2" />
          <textarea value={reason} onChange={e => setReason(e.target.value)} rows={6} placeholder="为什么要挂这个知识点？这道错题暴露的是哪个方法、概念或易错点？" className="rounded-xl border px-3 py-2" />

          <div className="flex flex-wrap gap-3">
            <button onClick={() => setPreviewOpen(prev => !prev)} className="rounded-xl border px-4 py-2">{previewOpen ? '收起预览' : '预览结构'}</button>
            <button onClick={() => { removeDraft(draftKey); setSavedAt('') }} className="rounded-xl border px-4 py-2">清除本地草稿</button>
            <button onClick={() => saveToServer(false)} disabled={saving} className="rounded-xl border px-4 py-2 disabled:opacity-50">{saving ? '保存中...' : '保存到工作台'}</button>
            <button onClick={() => saveToServer(true)} disabled={saving} className="rounded-xl border px-4 py-2 disabled:opacity-50">保存并标记完成</button>
          </div>

          {previewOpen ? <pre className="overflow-auto rounded-xl bg-slate-50 p-4 text-sm">{JSON.stringify(payload, null, 2)}</pre> : null}
        </div>
      </section>
    </main>
  )
}
