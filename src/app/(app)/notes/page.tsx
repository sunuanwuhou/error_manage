'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { format } from 'date-fns'

const INSIGHT_TYPES = [
  { value: 'rule', label: '做题规则', color: 'bg-blue-100 text-blue-700' },
  { value: 'trap', label: '易错陷阱', color: 'bg-red-100 text-red-700' },
  { value: 'formula', label: '公式记忆', color: 'bg-purple-100 text-purple-700' },
]

const NOTE_SOURCE_OPTIONS = ['通用', '错题复盘', '套卷总结', 'AI 草稿', '临考提醒', '规则沉淀']
const QUESTION_TYPES = ['判断推理', '言语理解', '数量关系', '资料分析', '常识判断']

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

function buildKnowledgePath(note: any) {
  return [note.type, inferDisplayModule2(note), inferDisplayModule3(note)]
    .filter(Boolean)
    .join(' / ')
}

function inferDisplayModule2(note: any) {
  const explicit = normalizeText(note.module2)
  if (explicit) return explicit
  const content = `${normalizeText(note.title)} ${normalizeText(note.content)}`
  if (note.type === '判断推理') {
    if (content.includes('[图]') || content.includes('图形')) return '图形推理'
    if (content.includes('定义')) return '定义判断'
    return '判断推理'
  }
  if (note.type === '常识判断') {
    if (/(习近平|共产党|党|军队|马克思主义|社会主义|南昌起义|古田会议)/.test(content)) return '政治'
    if (/(经济|消费|需求侧|供给侧|市场)/.test(content)) return '经济'
    if (/(法律|法治|宪法|刑法|民法)/.test(content)) return '法律'
    return '常识判断'
  }
  if (note.type === '资料分析') return '资料分析'
  if (note.type === '数量关系') return '数量关系'
  if (note.type === '言语理解') return '言语理解'
  return ''
}

function inferDisplayModule3(note: any) {
  const explicit = normalizeText(note.module3)
  if (explicit) return explicit
  const content = `${normalizeText(note.title)} ${normalizeText(note.content)}`
  if (note.type === '判断推理') {
    if (content.includes('[图]') || content.includes('图形')) return '图形规律'
  }
  if (note.type === '常识判断') {
    if (/(习近平|共产党|党|军队|马克思主义|社会主义|南昌起义|古田会议)/.test(content)) return '党史理论'
    if (/(经济|消费|需求侧|供给侧|市场)/.test(content)) return '宏观经济'
    if (/(法律|法治|宪法|刑法|民法)/.test(content)) return '法治常识'
  }
  return ''
}

function buildKnowledgeTree(notes: any[]) {
  const root = new Map<string, Map<string, Map<string, any[]>>>()
  notes.forEach(note => {
    const level1 = normalizeText(note.type) || '未分类'
    const level2 = inferDisplayModule2(note) || '未细分模块'
    const level3 = inferDisplayModule3(note) || normalizeText(note.title) || '具体知识点'
    if (!root.has(level1)) root.set(level1, new Map())
    const level2Map = root.get(level1)!
    if (!level2Map.has(level2)) level2Map.set(level2, new Map())
    const level3Map = level2Map.get(level2)!
    if (!level3Map.has(level3)) level3Map.set(level3, [])
    level3Map.get(level3)!.push(note)
  })

  return Array.from(root.entries()).map(([level1, level2Map]) => ({
    level1,
    count: Array.from(level2Map.values()).reduce(
      (sum, level3Map) => sum + Array.from(level3Map.values()).reduce((inner, items) => inner + items.length, 0),
      0
    ),
    children: Array.from(level2Map.entries()).map(([level2, level3Map]) => ({
      level2,
      count: Array.from(level3Map.values()).reduce((sum, items) => sum + items.length, 0),
      children: Array.from(level3Map.entries()).map(([level3, items]) => ({
        level3,
        count: items.length,
        notes: items,
      })),
    })),
  }))
}

function buildPracticeSearchLink(note: any) {
  const params = new URLSearchParams()
  params.set('type', normalizeText(note.type))
  const query = normalizeText(note.title) || normalizeText(note.module3) || normalizeText(note.module2)
  if (query) params.set('q', query)
  return `/search?${params.toString()}`
}

function findRelatedInsights(note: any, insights: any[]) {
  return insights.filter(ins => {
    const skillTag = normalizeText(ins.skillTag)
    return skillTag === normalizeText(note.title)
      || skillTag === normalizeText(note.module3)
      || skillTag === normalizeText(note.module2)
  })
}

function parseOptions(raw: string | undefined) {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function buildDisplayNoteBody(content: string | null | undefined) {
  const normalized = normalizeText(content)
  if (!normalized) return ''

  return normalized
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .filter(line => !/^题目[:：]/.test(line))
    .filter(line => !/^来源题目[:：]/.test(line))
    .join('\n\n')
}

function getLinkedCount(note: any) {
  return Number(note.resolvedSourceErrorCount ?? 0)
}

function buildLevel3Label(level3: { level3: string; notes: any[] }) {
  const singleKnowledgeNote = level3.notes.length === 1 ? level3.notes[0] : null
  if (!singleKnowledgeNote) return level3.level3

  const genericLabels = new Set(['知识点', '通用知识点', '未细分', '未细分知识点', '具体知识点'])
  const title = normalizeText(singleKnowledgeNote.title)
  if (title && (genericLabels.has(level3.level3) || title === level3.level3)) {
    return title
  }
  if (genericLabels.has(level3.level3)) {
    return title || '具体知识点'
  }
  return level3.level3
}

function buildLevel3Meta(level3: { count: number; notes: any[] }) {
  const singleKnowledgeNote = level3.notes.length === 1 ? level3.notes[0] : null
  if (!singleKnowledgeNote) return `${level3.count} 个知识点`

  const resolved = Number(singleKnowledgeNote.resolvedSourceErrorCount ?? 0)
  const stale = Number(singleKnowledgeNote.staleSourceErrorCount ?? 0)
  if (resolved > 0) return `1 篇 Markdown 笔记 · 关联错题 ${resolved} 道`
  if (stale > 0) return '1 篇 Markdown 笔记 · 历史关联已失效'
  return '1 篇 Markdown 笔记'
}

function shouldHideLevel3Header(level3: { level3: string; notes: any[] }) {
  const singleKnowledgeNote = level3.notes.length === 1 ? level3.notes[0] : null
  if (!singleKnowledgeNote) return false
  return buildLevel3Label(level3) === normalizeText(singleKnowledgeNote.title)
}

function renderSimpleMarkdown(content: string) {
  const lines = content.split('\n')
  const nodes: JSX.Element[] = []
  let inCodeBlock = false
  let codeLanguage = ''
  let codeBuffer: string[] = []

  lines.forEach((rawLine, index) => {
    const line = rawLine.trim()

    if (line.startsWith('```')) {
      if (inCodeBlock) {
        nodes.push(
          <figure key={`code-${index}`} className="my-3 overflow-hidden rounded-xl border border-gray-200 bg-gray-900">
            {codeLanguage ? (
              <div className="border-b border-white/10 px-3 py-1 text-[11px] text-gray-400">{codeLanguage}</div>
            ) : null}
            <pre className="overflow-x-auto px-3 py-3 text-xs leading-6 text-gray-100 whitespace-pre-wrap">
              <code>{codeBuffer.join('\n')}</code>
            </pre>
          </figure>
        )
        inCodeBlock = false
        codeLanguage = ''
        codeBuffer = []
      } else {
        inCodeBlock = true
        codeLanguage = line.slice(3).trim()
      }
      return
    }

    if (inCodeBlock) {
      codeBuffer.push(rawLine)
      return
    }

    if (!line) {
      nodes.push(<div key={`space-${index}`} className="h-3" />)
      return
    }

    const imageMatch = line.match(/^!\[(.*?)\]\((.+)\)$/)
    if (imageMatch) {
      nodes.push(
        <figure key={`img-${index}`} className="my-3">
          <img src={imageMatch[2]} alt={imageMatch[1] || '知识点图片'} className="w-full rounded-xl border border-gray-100 object-contain" />
          {imageMatch[1] ? <figcaption className="mt-1 text-xs text-gray-400">{imageMatch[1]}</figcaption> : null}
        </figure>
      )
      return
    }

    if (line.startsWith('### ')) {
      nodes.push(<h3 key={`h3-${index}`} className="mt-3 text-base font-semibold text-gray-900">{line.slice(4)}</h3>)
      return
    }
    if (line.startsWith('## ')) {
      nodes.push(<h2 key={`h2-${index}`} className="mt-4 text-lg font-semibold text-gray-900">{line.slice(3)}</h2>)
      return
    }
    if (line.startsWith('# ')) {
      nodes.push(<h1 key={`h1-${index}`} className="mt-4 text-xl font-bold text-gray-900">{line.slice(2)}</h1>)
      return
    }
    if (line.startsWith('- ')) {
      nodes.push(
        <div key={`li-${index}`} className="flex gap-2 text-sm leading-7 text-gray-700">
          <span className="mt-2 h-1.5 w-1.5 rounded-full bg-gray-400" />
          <span>{line.slice(2)}</span>
        </div>
      )
      return
    }

    nodes.push(
      <p key={`p-${index}`} className="text-sm leading-7 text-gray-700 whitespace-pre-wrap">
        {line}
      </p>
    )
  })

  if (inCodeBlock) {
    nodes.push(
      <figure key="code-unclosed" className="my-3 overflow-hidden rounded-xl border border-gray-200 bg-gray-900">
        {codeLanguage ? <div className="border-b border-white/10 px-3 py-1 text-[11px] text-gray-400">{codeLanguage}</div> : null}
        <pre className="overflow-x-auto px-3 py-3 text-xs leading-6 text-gray-100 whitespace-pre-wrap">
          <code>{codeBuffer.join('\n')}</code>
        </pre>
      </figure>
    )
  }

  return nodes
}

async function tryAppendClipboardImageMarkdown(
  event: React.ClipboardEvent<HTMLTextAreaElement>,
  onInsert: (markdown: string) => void
) {
  const image = Array.from(event.clipboardData.items).find(item => item.type.startsWith('image/'))
  if (!image) return false

  event.preventDefault()
  const file = image.getAsFile()
  if (!file) return false

  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })

  onInsert(`![贴图](${dataUrl})`)
  return true
}

function MarkdownEditorPanel({
  value,
  preview,
  onTogglePreview,
  onChange,
  onPaste,
  testId,
  compactHint = '可直接粘贴图片，也支持 Markdown / 简单图表代码块。',
  textareaRows = 10,
}: {
  value: string
  preview: boolean
  onTogglePreview: (preview: boolean) => void
  onChange: (value: string) => void
  onPaste: (event: React.ClipboardEvent<HTMLTextAreaElement>) => void
  testId?: string
  compactHint?: string
  textareaRows?: number
}) {
  return (
    <div data-testid={testId ?? 'markdown-editor-panel'} className="rounded-2xl border border-gray-100 bg-white p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => onTogglePreview(false)}
            data-testid="markdown-editor-toggle-edit"
            className={`rounded-lg px-3 py-1 text-xs ${!preview ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-500'}`}
          >
            编辑
          </button>
          <button
            type="button"
            onClick={() => onTogglePreview(true)}
            data-testid="markdown-editor-toggle-preview"
            className={`rounded-lg px-3 py-1 text-xs ${preview ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-500'}`}
          >
            预览
          </button>
        </div>
        <span className="text-xs text-gray-400">{compactHint}</span>
      </div>

      {preview ? (
        <div className="space-y-1">{renderSimpleMarkdown(value)}</div>
      ) : (
        <textarea
          value={value}
          onChange={e => onChange(e.target.value)}
          onPaste={onPaste}
          data-testid="markdown-editor-textarea"
          rows={textareaRows}
          placeholder="直接写知识点正文，支持 Markdown、图片粘贴、代码块/图表。"
          className="w-full resize-none rounded-xl border border-gray-200 px-3 py-3 text-sm leading-7 text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-400"
        />
      )}
    </div>
  )
}

export default function NotesPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [notes, setNotes] = useState<any[]>([])
  const [insights, setInsights] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [notesError, setNotesError] = useState('')
  const [insightsError, setInsightsError] = useState('')
  const [searchText, setSearchText] = useState('')
  const [noteTypeFilter, setNoteTypeFilter] = useState('全部')
  const [module2Filter, setModule2Filter] = useState('全部')
  const [module3Filter, setModule3Filter] = useState('全部')
  const [noteSourceFilter, setNoteSourceFilter] = useState('全部')
  const [showForm, setShowForm] = useState(false)
  const [editItem, setEditItem] = useState<any>(null)
  const [draftItem, setDraftItem] = useState<any>(null)
  const [message, setMessage] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)
  const [linkedErrors, setLinkedErrors] = useState<any[] | null>(null)
  const [linkedErrorsTitle, setLinkedErrorsTitle] = useState('')
  const [linkedErrorIndex, setLinkedErrorIndex] = useState(0)
  const [inlineEditId, setInlineEditId] = useState('')
  const [inlineDraftContent, setInlineDraftContent] = useState('')
  const [inlinePreview, setInlinePreview] = useState(false)
  const [inlineSaving, setInlineSaving] = useState(false)
  const [expandedLevel1, setExpandedLevel1] = useState<Record<string, boolean>>({})
  const [expandedLevel2, setExpandedLevel2] = useState<Record<string, boolean>>({})
  const [expandedLevel3, setExpandedLevel3] = useState<Record<string, boolean>>({})

  function loadData() {
    setLoading(true)
    setNotesError('')
    setInsightsError('')
    Promise.allSettled([
      fetch('/api/notes').then(async r => {
        const data = await r.json()
        if (!r.ok) throw new Error(data.error ?? '知识点加载失败')
        return data
      }),
      fetch('/api/insights').then(async r => {
        const data = await r.json()
        if (!r.ok) throw new Error(data.error ?? '历史规则摘要加载失败')
        return data
      }),
    ]).then(([notesResult, insightsResult]) => {
      if (notesResult.status === 'fulfilled') {
        setNotes(notesResult.value)
      } else {
        setNotes([])
        setNotesError(notesResult.reason?.message ?? '知识点加载失败')
      }

      if (insightsResult.status === 'fulfilled') {
        setInsights(insightsResult.value)
      } else {
        setInsights([])
        setInsightsError(insightsResult.reason?.message ?? '历史规则摘要加载失败')
      }

      if (notesResult.status === 'rejected' || insightsResult.status === 'rejected') {
        setMessage({ type: 'err', text: '部分内容加载失败，但知识树主流程仍可继续使用。' })
      }
      setLoading(false)
    })
  }

  useEffect(() => { loadData() }, [])

  useEffect(() => {
    const draft = searchParams.get('draft')
    if (draft !== '1') return

    const draftKind = searchParams.get('draftKind') === 'insights' ? 'insights' : 'notes'
    const title = searchParams.get('draftTitle') || searchParams.get('draftSkillTag') || ''
    const content = draftKind === 'insights'
      ? [
          searchParams.get('draftFinalContent') ? `规则摘要：${searchParams.get('draftFinalContent')}` : '',
          searchParams.get('draftAiDraft') ? `AI 草稿：${searchParams.get('draftAiDraft')}` : '',
          searchParams.get('draftDomainExamples') ? `典型例子：${searchParams.get('draftDomainExamples')}` : '',
        ].filter(Boolean).join('\n\n')
      : (searchParams.get('draftContent') ?? '')

    setEditItem(null)
    setDraftItem({
      kind: 'notes',
      type: searchParams.get('draftType') ?? undefined,
      subtype: draftKind === 'insights' ? '规则沉淀' : (searchParams.get('draftSubtype') ?? undefined),
      module2: searchParams.get('draftModule2') ?? '',
      module3: searchParams.get('draftModule3') ?? '',
      title,
      content,
      isPrivate: searchParams.get('draftPrivate') === '1',
      sourceErrorIds: searchParams.get('draftSourceErrorIds') ?? '',
    })
    setShowForm(true)
    router.replace('/notes', { scroll: false })
  }, [router, searchParams])

  const normalizedSearch = searchText.trim().toLowerCase()
  const module2Options = useMemo(() => {
    const scoped = noteTypeFilter === '全部' ? notes : notes.filter(n => n.type === noteTypeFilter)
    return ['全部', ...Array.from(new Set(scoped.map(n => normalizeText(n.module2)).filter(Boolean)))]
  }, [notes, noteTypeFilter])

  const module3Options = useMemo(() => {
    const scoped = notes.filter(n => {
      if (noteTypeFilter !== '全部' && n.type !== noteTypeFilter) return false
      if (module2Filter !== '全部' && normalizeText(n.module2) !== module2Filter) return false
      return true
    })
    return ['全部', ...Array.from(new Set(scoped.map(n => normalizeText(n.module3)).filter(Boolean)))]
  }, [notes, noteTypeFilter, module2Filter])

  const filteredNotes = notes.filter(n => {
    if (noteTypeFilter !== '全部' && n.type !== noteTypeFilter) return false
    if (module2Filter !== '全部' && normalizeText(n.module2) !== module2Filter) return false
    if (module3Filter !== '全部' && normalizeText(n.module3) !== module3Filter) return false
    const noteSource = normalizeText(n.subtype) || '通用'
    if (noteSourceFilter !== '全部' && noteSource !== noteSourceFilter) return false
    if (!normalizedSearch) return true
    return [n.title, n.content, n.type, n.subtype, n.module2, n.module3, n.sourceErrorIds]
      .filter(Boolean)
      .some((value: string) => value.toLowerCase().includes(normalizedSearch))
  })
  const knowledgeTree = useMemo(() => buildKnowledgeTree(filteredNotes), [filteredNotes])

  async function deleteNote(id: string) {
    if (!confirm('删除这个知识点？')) return
    const res = await fetch(`/api/notes?id=${id}`, { method: 'DELETE' })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setMessage({ type: 'err', text: data.error ?? '删除失败' })
      return
    }
    setMessage({ type: 'ok', text: '删除成功' })
    loadData()
  }

  async function openLinkedErrors(note: any) {
    const ids = Array.isArray(note.resolvedSourceErrorIds)
      ? note.resolvedSourceErrorIds
      : normalizeText(note.sourceErrorIds)
          .split(',')
          .map(item => item.trim())
          .filter(Boolean)
    if (ids.length === 0) return

    const res = await fetch(`/api/errors?ids=${encodeURIComponent(ids.join(','))}`)
    const data = await res.json().catch(() => ({ items: [] }))
    setLinkedErrors(data.items ?? [])
    setLinkedErrorsTitle(note.title)
    setLinkedErrorIndex(0)
  }

  function startInlineEdit(note: any) {
    setInlineEditId(note.id)
    setInlineDraftContent(note.content ?? '')
    setInlinePreview(false)
  }

  function cancelInlineEdit() {
    setInlineEditId('')
    setInlineDraftContent('')
    setInlinePreview(false)
    setInlineSaving(false)
  }

  async function saveInlineEdit(note: any) {
    setInlineSaving(true)
    const res = await fetch('/api/notes', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: note.id,
        title: note.title,
        content: inlineDraftContent,
        subtype: note.subtype,
        module2: note.module2,
        module3: note.module3,
        sourceErrorIds: note.sourceErrorIds,
        isPrivate: note.isPrivate,
      }),
    })

    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setMessage({ type: 'err', text: data.error ?? '保存失败' })
      setInlineSaving(false)
      return
    }

    setMessage({ type: 'ok', text: '知识点已更新' })
    cancelInlineEdit()
    loadData()
  }

  async function handleInlinePaste(event: React.ClipboardEvent<HTMLTextAreaElement>) {
    const pasted = await tryAppendClipboardImageMarkdown(event, markdown => {
      setInlineDraftContent(prev => (prev ? `${prev}\n\n${markdown}` : markdown))
    })
    if (pasted) setMessage({ type: 'ok', text: '图片已贴入知识点正文' })
  }

  return (
    <div data-testid="knowledge-tree-page" className="max-w-lg mx-auto px-4 pt-4 pb-8">
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">知识树</h1>
          <p className="text-xs text-gray-400 mt-1">按 一级模块 / 二级模块 / 三级模块 / 具体知识点 组织。</p>
          <p className="text-xs text-gray-400 mt-1">一个知识点就是一篇可编辑的 Markdown 笔记，错题和规则摘要挂在这篇笔记下面。</p>
        </div>
        <button
          onClick={() => { setEditItem(null); setDraftItem(null); setShowForm(true) }}
          data-testid="knowledge-tree-add-button"
          className="bg-blue-600 text-white text-sm px-4 py-2 rounded-xl font-medium min-h-[44px] flex items-center"
        >
          + 新增知识点
        </button>
      </div>

      {message && (
        <div className={`mb-4 rounded-xl px-4 py-3 text-sm ${message.type === 'ok' ? 'bg-green-50 text-green-600 border border-green-200' : 'bg-red-50 text-red-600 border border-red-200'}`}>
          {message.text}
        </div>
      )}

      <div className="mb-4 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm lg:p-5">
        <input
          value={searchText}
          onChange={e => setSearchText(e.target.value)}
          data-testid="knowledge-tree-search"
          placeholder="搜索知识点"
          className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
        />
        <p className="mt-3 text-xs text-gray-400">
          共 {notes.length} 个知识点，当前显示 {filteredNotes.length} 个
        </p>
      </div>

      {loading ? (
        <div className="space-y-3">{[1, 2, 3].map(i => <div key={i} className="h-20 bg-gray-100 rounded-2xl animate-pulse" />)}</div>
      ) : (
        <>
          {notesError ? (
            <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-600">
              {notesError}
            </div>
          ) : filteredNotes.length === 0 ? (
            <div className="text-center py-12 text-gray-400">
              <p className="text-4xl mb-2">📝</p>
              <p>还没有知识点</p>
            </div>
          ) : (
            <div className="space-y-4">
              {knowledgeTree.map(level1 => {
                const level1Key = level1.level1
                const level1Open = expandedLevel1[level1Key] ?? true
                return (
                  <div key={level1Key} className="rounded-2xl border border-gray-100 bg-white shadow-sm">
                    <button
                      type="button"
                      onClick={() => setExpandedLevel1(prev => ({ ...prev, [level1Key]: !level1Open }))}
                      className="flex w-full items-center justify-between px-4 py-4 text-left"
                    >
                      <div>
                        <p className="font-semibold text-gray-900">{level1.level1}</p>
                        <p className="text-xs text-gray-400 mt-1">{level1.count} 个知识点</p>
                      </div>
                      <span className="text-gray-300">{level1Open ? '−' : '+'}</span>
                    </button>
                    {level1Open && (
                      <div className="border-t border-gray-100 px-3 py-3 space-y-3">
                        {level1.children.map(level2 => {
                          const level2Key = `${level1Key}::${level2.level2}`
                          const level2Open = expandedLevel2[level2Key] ?? false
                          return (
                            <div key={level2Key} className="rounded-2xl bg-gray-50 px-3 py-3">
                              <button
                                type="button"
                                onClick={() => setExpandedLevel2(prev => ({ ...prev, [level2Key]: !level2Open }))}
                                className="flex w-full items-center justify-between text-left"
                              >
                                <div>
                                  <p className="text-sm font-semibold text-gray-800">{level2.level2}</p>
                                  <p className="text-xs text-gray-400 mt-1">{level2.count} 个知识点</p>
                                </div>
                                <span className="text-gray-300">{level2Open ? '−' : '+'}</span>
                              </button>
                              {level2Open && (
                                <div className="mt-3 space-y-3">
                                  {level2.children.map(level3 => {
                                    const level3Key = `${level2Key}::${level3.level3}`
                                    const level3Open = expandedLevel3[level3Key] ?? false
                                    const singleKnowledgeNote = level3.notes.length === 1 ? level3.notes[0] : null
                                    const level3Label = buildLevel3Label(level3)
                                    const level3Meta = buildLevel3Meta(level3)
                                    return (
                                      <div key={level3Key} className="rounded-2xl border border-gray-200 bg-white p-3">
                                        <div className="flex items-center justify-between gap-3">
                                          <button
                                            type="button"
                                            onClick={() => setExpandedLevel3(prev => ({ ...prev, [level3Key]: !level3Open }))}
                                            className="flex min-w-0 flex-1 items-center justify-between text-left"
                                          >
                                            <div>
                                              <p className="text-sm font-medium text-gray-700">{level3Label}</p>
                                              <p className="text-xs text-gray-400 mt-1">{level3Meta}</p>
                                            </div>
                                            <span className="text-gray-300">{level3Open ? '−' : '+'}</span>
                                          </button>
                                          {singleKnowledgeNote && (
                                          <button
                                            type="button"
                                            onClick={() => {
                                              startInlineEdit(singleKnowledgeNote)
                                              }}
                                            data-testid="knowledge-note-edit-button"
                                              className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-600"
                                            >
                                              编辑 Markdown
                                            </button>
                                          )}
                                        </div>
                                        {level3Open && (
                                          <div className="mt-3 space-y-3">
                                            {level3.notes.map(n => {
                                              const relatedInsights = findRelatedInsights(n, insights)
                                              const linkedCount = Number(n.resolvedSourceErrorCount ?? 0)
                                              const staleCount = Number(n.staleSourceErrorCount ?? 0)
                                              const displayBody = buildDisplayNoteBody(n.content)
                                              return (
                                                <div key={n.id} data-testid="knowledge-note-card" className="rounded-2xl border border-gray-100 bg-gray-50 p-4">
                                                  <div className="mb-3 flex items-start justify-between gap-3">
                                                    <div className="min-w-0">
                                                      <p className="text-base font-semibold text-gray-900">{n.title}</p>
                                                      <p className="mt-1 text-xs text-gray-400">{buildKnowledgePath(n)}</p>
                                                    </div>
                                                    <div className="flex shrink-0 gap-2">
                                                      <button data-testid="knowledge-note-inline-edit" onClick={() => startInlineEdit(n)} className="text-xs text-blue-500">编辑</button>
                                                      <button data-testid="knowledge-note-delete" onClick={() => deleteNote(n.id)} className="text-xs text-red-400">删除</button>
                                                    </div>
                                                  </div>

                                                  {inlineEditId === n.id ? (
                                                    <div className="rounded-xl bg-white p-4">
                                                      <MarkdownEditorPanel
                                                        value={inlineDraftContent}
                                                        preview={inlinePreview}
                                                        onTogglePreview={setInlinePreview}
                                                        onChange={setInlineDraftContent}
                                                        onPaste={handleInlinePaste}
                                                        testId={`knowledge-note-inline-editor-${n.id}`}
                                                        textareaRows={10}
                                                        compactHint="可直接粘贴图片，也支持 Markdown / 图表代码块。"
                                                      />

                                                      <div className="mt-3 flex gap-2">
                                                        <button
                                                          type="button"
                                                          onClick={() => saveInlineEdit(n)}
                                                          data-testid="knowledge-note-inline-save"
                                                          disabled={inlineSaving}
                                                          className="rounded-xl bg-blue-600 px-4 py-2 text-xs font-medium text-white disabled:opacity-60"
                                                        >
                                                          {inlineSaving ? '保存中...' : '保存正文'}
                                                        </button>
                                                        <button
                                                          type="button"
                                                          onClick={cancelInlineEdit}
                                                          data-testid="knowledge-note-inline-cancel"
                                                          className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-xs font-medium text-gray-600"
                                                        >
                                                          取消
                                                        </button>
                                                      </div>
                                                    </div>
                                                  ) : displayBody ? (
                                                    <div className="rounded-xl bg-white p-4">
                                                      <div className="space-y-1">{renderSimpleMarkdown(displayBody)}</div>
                                                    </div>
                                                  ) : (
                                                    <div className="rounded-xl bg-white p-4 text-sm text-gray-400">
                                                      这篇知识点还没有正文，先点“编辑 Markdown”补充内容。
                                                    </div>
                                                  )}

                                                  {linkedCount > 0 ? (
                                                    <button
                                                      type="button"
                                                      onClick={() => openLinkedErrors(n)}
                                                      className="mt-3 w-full rounded-xl bg-amber-50 p-3 text-left text-sm text-amber-700"
                                                    >
                                                      关联错题 {linkedCount} 道，点击查看
                                                    </button>
                                                  ) : staleCount > 0 ? (
                                                    <div className="mt-3 rounded-xl bg-gray-100 p-3 text-sm text-gray-500">
                                                      历史关联已失效，当前没有可查看的错题。
                                                    </div>
                                                  ) : null}

                                                  {relatedInsights.length > 0 && (
                                                    <div className="mt-3 rounded-xl bg-purple-50 p-3">
                                                      <p className="mb-2 text-xs font-medium text-purple-600">规则摘要 {relatedInsights.length} 条</p>
                                                      <div className="space-y-2">
                                                        {relatedInsights.slice(0, 2).map(ins => (
                                                          <div key={ins.id} className="rounded-lg bg-white/70 px-3 py-2 text-xs text-purple-800">
                                                            <div className="mb-1 flex items-center gap-2">
                                                              <span className={`rounded-full px-2 py-0.5 ${INSIGHT_TYPES.find(t => t.value === ins.insightType)?.color ?? 'bg-gray-100 text-gray-500'}`}>
                                                                {INSIGHT_TYPES.find(t => t.value === ins.insightType)?.label ?? '规则摘要'}
                                                              </span>
                                                              <span className="text-[11px] text-purple-500">{buildInsightSourceLabel(ins)}</span>
                                                            </div>
                                                            <div>{ins.finalContent}</div>
                                                          </div>
                                                        ))}
                                                      </div>
                                                    </div>
                                                  )}

                                                  <div className="mt-3 flex gap-2">
                                                    <button
                                                      type="button"
                                                      onClick={() => router.push(buildPracticeSearchLink(n))}
                                                      className="rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-medium text-blue-700"
                                                    >
                                                      去练这类题
                                                    </button>
                                                    <button
                                                      type="button"
                                                      onClick={() => startInlineEdit(n)}
                                                      className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-600"
                                                    >
                                                      编辑 Markdown
                                                    </button>
                                                  </div>

                                                  <div className="mt-2 flex items-center justify-between gap-3 text-xs text-gray-300">
                                                    <p>{format(new Date(n.updatedAt), 'MM-dd HH:mm')}</p>
                                                    <p>{n.isPrivate ? '仅自己可见' : '知识点笔记'}</p>
                                                  </div>
                                                </div>
                                              )
                                            })}
                                          </div>
                                        )}
                                      </div>
                                    )
                                  })}
                                </div>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {insightsError && (
            <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-700">
              历史规则摘要加载失败，不影响知识树主流程。你仍可继续整理知识点和查看关联错题。
            </div>
          )}
        </>
      )}

      {showForm && (
        <KnowledgeForm
          editItem={editItem}
          draftItem={draftItem}
          onClose={() => { setShowForm(false); setEditItem(null); setDraftItem(null); loadData() }}
          onSaved={(text, type) => setMessage({ text, type })}
        />
      )}

      {linkedErrors && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center">
          <div className="w-full max-w-lg rounded-t-3xl bg-white p-6 sm:rounded-2xl max-h-[90vh] overflow-y-auto">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-bold text-gray-900">{linkedErrorsTitle}</h3>
                <p className="text-xs text-gray-400 mt-1">这篇知识点笔记下关联的错题</p>
              </div>
              <button onClick={() => { setLinkedErrors(null); setLinkedErrorIndex(0) }} className="text-2xl text-gray-400">×</button>
            </div>
            {linkedErrors.length > 0 && (
              <div className="mb-3 flex items-center justify-between text-xs text-gray-400">
                <span>第 {linkedErrorIndex + 1} 题 / 共 {linkedErrors.length} 题</span>
                {linkedErrors.length > 1 && (
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={linkedErrorIndex === 0}
                      onClick={() => setLinkedErrorIndex(index => Math.max(0, index - 1))}
                      className="rounded-lg border border-gray-200 px-3 py-1 text-gray-600 disabled:opacity-30"
                    >
                      上一题
                    </button>
                    <button
                      type="button"
                      disabled={linkedErrorIndex >= linkedErrors.length - 1}
                      onClick={() => setLinkedErrorIndex(index => Math.min(linkedErrors.length - 1, index + 1))}
                      className="rounded-lg border border-gray-200 px-3 py-1 text-gray-600 disabled:opacity-30"
                    >
                      下一题
                    </button>
                  </div>
                )}
              </div>
            )}
            <div className="space-y-3">
              {linkedErrors.length > 0 && (() => {
                const item = linkedErrors[linkedErrorIndex]
                return (
                <div key={item.id} className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
                  <div className="mb-2 flex items-center gap-2">
                    <span className="rounded-lg bg-gray-100 px-2 py-0.5 text-xs text-gray-500">{item.question.type}</span>
                    {item.question.subtype && (
                      <span className="rounded-lg bg-blue-50 px-2 py-0.5 text-xs text-blue-600">{item.question.subtype}</span>
                    )}
                    <span className="text-xs text-gray-400">掌握度 {item.masteryPercent}%</span>
                  </div>
                  {item.question.questionImage && (
                    <img
                      src={item.question.questionImage}
                      alt="错题图片"
                      className="mb-3 w-full rounded-xl border border-gray-100 object-contain"
                    />
                  )}
                  <p className="text-sm text-gray-700 whitespace-pre-wrap">{item.question.content}</p>
                  {parseOptions(item.question.options).length > 0 && (
                    <div className="mt-3 space-y-2 rounded-xl bg-gray-50 p-3">
                      {parseOptions(item.question.options).map((option: string, idx: number) => (
                        <div key={`${item.id}-${idx}`} className="text-sm text-gray-600 whitespace-pre-wrap">
                          {option}
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="mt-3 flex items-center justify-between gap-3">
                    <p className="text-xs text-green-700">正确答案：{item.question.answer}</p>
                    <button
                      type="button"
                      onClick={() => router.push(`/errors?ids=${encodeURIComponent(item.id)}`)}
                      className="text-xs text-blue-600 underline"
                    >
                      去错题本查看
                    </button>
                  </div>
                </div>
                )
              })()}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function KnowledgeForm({
  editItem,
  draftItem,
  onClose,
  onSaved,
}: {
  editItem: any
  draftItem: any
  onClose: () => void
  onSaved: (text: string, type: 'ok' | 'err') => void
}) {
  const [saving, setSaving] = useState(false)
  const [preview, setPreview] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(Boolean(
    normalizeText(editItem?.module2)
    || normalizeText(editItem?.module3)
    || normalizeText(editItem?.sourceErrorIds)
    || editItem?.isPrivate
    || normalizeText(draftItem?.module2)
    || normalizeText(draftItem?.module3)
    || normalizeText(draftItem?.sourceErrorIds)
    || draftItem?.isPrivate
  ))
  const [pasteTip, setPasteTip] = useState('')
  const [form, setForm] = useState({
    noteType: editItem?.type ?? draftItem?.type ?? '判断推理',
    noteSubtype: normalizeText(editItem?.subtype) || normalizeText(draftItem?.subtype) || '通用',
    module2: normalizeText(editItem?.module2) || normalizeText(draftItem?.module2) || '',
    module3: normalizeText(editItem?.module3) || normalizeText(draftItem?.module3) || '',
    sourceErrorIds: normalizeText(editItem?.sourceErrorIds) || normalizeText(draftItem?.sourceErrorIds) || '',
    title: editItem?.title ?? draftItem?.title ?? '',
    content: editItem?.content ?? draftItem?.content ?? '',
    isPrivate: editItem?.isPrivate ?? draftItem?.isPrivate ?? false,
  })

  const pathPreview = [form.noteType, form.module2, form.module3, form.title]
    .map(normalizeText)
    .filter(Boolean)
    .join(' / ')

  async function handleComposerPaste(event: React.ClipboardEvent<HTMLTextAreaElement>) {
    const pasted = await tryAppendClipboardImageMarkdown(event, markdown => {
      setForm(prev => ({
        ...prev,
        content: prev.content ? `${prev.content}\n\n${markdown}` : markdown,
      }))
    })
    if (pasted) setPasteTip('图片已贴入知识点正文')
  }

  async function handleSave() {
    setSaving(true)
    const method = editItem ? 'PATCH' : 'POST'
    const body = editItem
      ? {
          id: editItem.id,
          title: form.title,
          content: form.content,
          subtype: form.noteSubtype,
          module2: form.module2,
          module3: form.module3,
          sourceErrorIds: form.sourceErrorIds,
          isPrivate: form.isPrivate,
        }
      : {
          type: form.noteType,
          title: form.title,
          content: form.content,
          subtype: form.noteSubtype,
          module2: form.module2,
          module3: form.module3,
          sourceErrorIds: form.sourceErrorIds,
          isPrivate: form.isPrivate,
        }

    const res = await fetch('/api/notes', {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      onSaved(data.error ?? '保存失败', 'err')
      setSaving(false)
      return
    }

    const data = await res.json().catch(() => ({}))
    if (data?.deduped) {
      onSaved('已存在同知识点，未重复创建', 'ok')
      setSaving(false)
      onClose()
      return
    }

    onSaved(editItem ? '更新成功' : '保存成功', 'ok')
    setSaving(false)
    onClose()
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50">
      <div data-testid="knowledge-form" className="bg-white rounded-t-3xl sm:rounded-2xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-lg text-gray-900">{editItem ? '编辑知识点 Markdown' : '新增知识点 Markdown'}</h3>
          <button onClick={onClose} className="text-gray-400 text-2xl">×</button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">知识点标题</label>
            <input
              value={form.title}
              onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
              data-testid="knowledge-form-title"
              placeholder="先写知识点名字，例如：图形规律 / 立体截面"
              className="w-full px-4 py-3 border border-gray-200 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
            <p className="mt-2 text-xs text-gray-400">
              路径预览：{pathPreview || '先写标题，其他信息可收起'}
            </p>
          </div>

          <MarkdownEditorPanel
            value={form.content}
            preview={preview}
            onTogglePreview={setPreview}
            onChange={value => setForm(f => ({ ...f, content: value }))}
            onPaste={handleComposerPaste}
            testId="knowledge-form-content"
            textareaRows={12}
            compactHint="正文优先，直接粘贴图片，也支持 Markdown / 图表代码块。"
          />

          {pasteTip && <p className="text-xs text-blue-500">{pasteTip}</p>}

          <button
            type="button"
            onClick={() => setShowAdvanced(v => !v)}
            className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-4 py-2 text-sm font-medium text-gray-600"
          >
            {showAdvanced ? '收起更多信息' : '展开更多信息'}
          </button>

          {showAdvanced && (
            <div className="space-y-3 rounded-2xl border border-gray-100 bg-gray-50 p-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">一级模块</label>
                  <select
                    value={form.noteType}
                    onChange={e => setForm(f => ({ ...f, noteType: e.target.value }))}
                    data-testid="knowledge-form-type"
                    className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  >
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
                <select
                  value={form.noteSubtype}
                  onChange={e => setForm(f => ({ ...f, noteSubtype: e.target.value }))}
                  data-testid="knowledge-form-subtype"
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                >
                  {NOTE_SOURCE_OPTIONS.map(t => <option key={t}>{t}</option>)}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">二级模块</label>
                  <input
                    value={form.module2}
                    onChange={e => setForm(f => ({ ...f, module2: e.target.value }))}
                    data-testid="knowledge-form-module2"
                    placeholder="如：图形推理"
                    className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">三级模块</label>
                  <input
                    value={form.module3}
                    onChange={e => setForm(f => ({ ...f, module3: e.target.value }))}
                    data-testid="knowledge-form-module3"
                    placeholder="如：立体截面"
                    className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">关联错题 / 题号</label>
                <input
                  value={form.sourceErrorIds}
                  onChange={e => setForm(f => ({ ...f, sourceErrorIds: e.target.value }))}
                  data-testid="knowledge-form-source-error-ids"
                  placeholder="如：cmmx...001, cmmx...002"
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                />
              </div>
            </div>
          )}

          <p className="text-xs text-gray-400">
            一个知识点就是一篇 Markdown 笔记；先写正文，其他信息按需补充。
          </p>

          <button
            onClick={handleSave}
            disabled={saving}
            data-testid="knowledge-form-save"
            className="w-full py-3 bg-blue-600 text-white rounded-xl text-sm font-medium disabled:opacity-60"
          >
            {saving ? '保存中...' : editItem ? '保存修改' : '保存知识点'}
          </button>
        </div>
      </div>
    </div>
  )
}
