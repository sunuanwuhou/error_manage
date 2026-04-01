'use client'

import Link from 'next/link'
import { useEffect, useMemo, useRef, useState } from 'react'
import { buildPaperKey } from '@/lib/paper-key'
import { buildProofSuggestions, type ProofSuggestion } from '@/lib/import/auto-proofread'
import { evaluateImportQuality, inferQuestionType, isPublishBlocked, type ImportQualityIssue } from '@/lib/import/quality-gate'
import { autoFixBatch, type AutoFixStats } from '@/lib/import/auto-fix'

type PreviewItem = {
  index: number
  no: string
  content: string
  questionImage?: string
  options: string[]
  answer: string
  type: string
  analysis?: string
  hasAnalysis?: boolean
  rawText?: string
  fileName?: string
  relativePath?: string
}

type FileSummaryItem = {
  fileName: string
  relativePath?: string
  total: number
  warnings: string[]
  status: string
}

type ImportJobItem = {
  id: string
  filename: string
  status: string
  importedCount: number
  createdAt: string
}

type InferredMeta = {
  srcYear?: string
  srcProvince?: string
  examType?: string
  srcSession?: string
  srcPaperCode?: string
  postHint?: string
}

type ConfirmResult = {
  imported: number
  skipped: number
  overwritten: number
  addedToErrors: number
  lowQuality: number
  failed: number
  total: number
  stableIdUpdates?: number
  duplicateStrategyNote?: string
  typeBreakdown?: Record<string, number>
  qualityReport?: Array<{ no: string; score: number; issues: string[] }>
  failureReport?: Array<{ no: string; message: string }>
  paperKey?: string
  practiceHref?: string
  practiceHrefLimit20?: string
}

type PrecheckResult = {
  duplicated: boolean
  matchedQuestions: number
  matchedImportJobs: number
  message: string
}

type PrepublishResult = {
  total: number
  publishableCount: number
  blockedCount: number
  warningCount: number
  recommendedIndexes: number[]
  blockedQuestions: Array<{ index: number; no: string; issues: string[]; type: string }>
  warningQuestions: Array<{ index: number; no: string; issues: string[]; type: string }>
  typeBreakdown: Record<string, number>
}

type PostPublishRepairCandidate = {
  id: string
  no: string
  type: string
  issues: Array<{ code: string; label: string; severity: 'info' | 'warn' | 'block' }>
  current: PreviewItem
  suggested: PreviewItem
}

type PostPublishAuditResult = {
  paperKey: string
  total: number
  typeBreakdown: Record<string, number>
  duplicateOrders: Array<{ value: string; count: number }>
  duplicateNos: Array<{ value: string; count: number }>
  blockerCount: number
  warningCount: number
  blockers: Array<{ id: string; no: string; type: string; issues: string[] }>
  warnings: Array<{ id: string; no: string; type: string; issues: string[] }>
  sample: Array<{ id: string; no: string; order: number; type: string; content: string; answer: string; options: string[] }>
}


type PostPublishRepairApplyResult = {
  ok: boolean
  paperKey: string
  scanned: number
  updated: number
  skipped: number
  samples: Array<{ id: string; no: string; changedFields: string[] }>
}
function emptyOptionsTo4(options: string[]) {
  const next = [...(options || [])]
  while (next.length < 4) next.push('')
  return next.slice(0, 4)
}

function statusBadge(status: string) {
  const map: Record<string, string> = {
    parsed: 'bg-blue-100 text-blue-700',
    reviewing: 'bg-amber-100 text-amber-700',
    done: 'bg-green-100 text-green-700',
    done_with_errors: 'bg-orange-100 text-orange-700',
    failed: 'bg-red-100 text-red-700',
  }
  return map[status] || 'bg-slate-100 text-slate-700'
}

function buildOriginalSnippet(item: PreviewItem) {
  const blocks: string[] = []
  if (item.rawText?.trim()) blocks.push(item.rawText.trim())
  else {
    blocks.push(item.content || '')
    if (item.options?.length) blocks.push(item.options.filter(Boolean).join('\n'))
    if (item.analysis?.trim()) blocks.push(`解析：${item.analysis.trim()}`)
  }
  return blocks.join('\n\n').trim()
}

function suggestionBadge(level: ProofSuggestion['level']) {
  if (level === 'high') return 'bg-red-100 text-red-700'
  if (level === 'medium') return 'bg-amber-100 text-amber-800'
  return 'bg-slate-100 text-slate-700'
}

function issueBadge(issue: ImportQualityIssue) {
  if (issue.severity === 'block') return 'bg-red-100 text-red-700'
  if (issue.severity === 'warn') return 'bg-amber-100 text-amber-800'
  return 'bg-blue-100 text-blue-700'
}

function normalizePreviewItem(item: PreviewItem): PreviewItem {
  return {
    ...item,
    type: inferQuestionType(item as any),
  }
}

export default function ImportPage() {
  const [file, setFile] = useState<File | null>(null)
  const [batchFiles, setBatchFiles] = useState<File[]>([])
  const [batchMode, setBatchMode] = useState<'single' | 'multi' | 'folder'>('single')
  const [examType, setExamType] = useState('guo_kao')
  const [srcName, setSrcName] = useState('')
  const [loading, setLoading] = useState(false)
  const [warnings, setWarnings] = useState<string[]>([])
  const [fileSummaries, setFileSummaries] = useState<FileSummaryItem[]>([])
  const [fileFilter, setFileFilter] = useState('all')
  const [precheck, setPrecheck] = useState<PrecheckResult | null>(null)
  const [prechecking, setPrechecking] = useState(false)
  const [preview, setPreview] = useState<PreviewItem[]>([])
  const [payload, setPayload] = useState('')
  const [importJobId, setImportJobId] = useState('')
  const [selected, setSelected] = useState<number[]>([])
  const [addToErrors, setAddToErrors] = useState<number[]>([])
  const [confirmResult, setConfirmResult] = useState<ConfirmResult | null>(null)
  const [jobs, setJobs] = useState<ImportJobItem[]>([])
  const [detailLoading, setDetailLoading] = useState(false)
  const [savingReview, setSavingReview] = useState(false)
  const [lastSavedAt, setLastSavedAt] = useState('')
  const [dirty, setDirty] = useState(false)
  const [inferredMeta, setInferredMeta] = useState<InferredMeta>({})
  const [srcSession, setSrcSession] = useState('')
  const [srcOrigin, setSrcOrigin] = useState('file_import')
  const [batchType, setBatchType] = useState('单项选择题')
  const [duplicateMode, setDuplicateMode] = useState<'skip' | 'replace_low_quality' | 'force_replace'>('replace_low_quality')
  const [jobQuery, setJobQuery] = useState('')
  const [jobStatus, setJobStatus] = useState('all')
  const [jobSort, setJobSort] = useState<'newest' | 'oldest' | 'name'>('newest')
  const [jobPage, setJobPage] = useState(1)
  const [questionQuery, setQuestionQuery] = useState('')
  const [onlyIssueItems, setOnlyIssueItems] = useState(false)
  const [onlyBlockedItems, setOnlyBlockedItems] = useState(false)
  const [currentIndex, setCurrentIndex] = useState(0)
  const [deletingJobId, setDeletingJobId] = useState('')
  const [bootstrappedByQuery, setBootstrappedByQuery] = useState(false)
  const [readyToPublishHint, setReadyToPublishHint] = useState(false)
  const [autoFixStats, setAutoFixStats] = useState<AutoFixStats | null>(null)
  const [prepublish, setPrepublish] = useState<PrepublishResult | null>(null)
  const [postPublishAudit, setPostPublishAudit] = useState<PostPublishAuditResult | null>(null)
  const [postPublishRepairApply, setPostPublishRepairApply] = useState<PostPublishRepairApplyResult | null>(null)
  const [auditingPublish, setAuditingPublish] = useState(false)
  const [loadingRepairPack, setLoadingRepairPack] = useState(false)
  const [applyingPublishRepair, setApplyingPublishRepair] = useState(false)
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const originalRefs = useRef<Record<number, HTMLDivElement | null>>({})
  const folderInputRef = useRef<HTMLInputElement | null>(null)

  const JOB_PAGE_SIZE = 8
  const searchParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null

  const qualityMap = useMemo(() => {
    const next = new Map<number, ReturnType<typeof evaluateImportQuality>>()
    preview.forEach(item => next.set(item.index, evaluateImportQuality(item as any)))
    return next
  }, [preview])

  const paperKey = useMemo(() => buildPaperKey({
    srcYear: inferredMeta.srcYear,
    srcProvince: inferredMeta.srcProvince,
    examType: inferredMeta.examType,
  }), [inferredMeta])

  const filteredJobs = useMemo(() => {
    const next = jobs.filter(job => {
      const matchQ = !jobQuery || job.filename.toLowerCase().includes(jobQuery.toLowerCase())
      const matchStatus = jobStatus === 'all' || job.status === jobStatus
      return matchQ && matchStatus
    })
    if (jobSort === 'newest') next.sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))
    else if (jobSort === 'oldest') next.sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt))
    else next.sort((a, b) => a.filename.localeCompare(b.filename, 'zh-CN'))
    return next
  }, [jobs, jobQuery, jobStatus, jobSort])

  const pagedJobs = useMemo(() => {
    const start = (jobPage - 1) * JOB_PAGE_SIZE
    return filteredJobs.slice(start, start + JOB_PAGE_SIZE)
  }, [filteredJobs, jobPage])

  const totalJobPages = useMemo(() => Math.max(1, Math.ceil(filteredJobs.length / JOB_PAGE_SIZE)), [filteredJobs.length])

  const issueStats = useMemo(() => {
    let blockers = 0
    let missingAnswer = 0
    let missingAnalysis = 0
    let lowQuality = 0
    let judgment = 0
    let multi = 0
    let figure = 0
    let broken = 0

    preview.forEach(item => {
      const result = qualityMap.get(item.index)
      if (!result) return
      if (result.blockers.length) blockers += 1
      result.issues.forEach(issue => {
        if (issue.code === 'missing_answer') missingAnswer += 1
        if (issue.code === 'missing_analysis') missingAnalysis += 1
        if (issue.code === 'low_quality') lowQuality += 1
        if (issue.code === 'judgment_detected') judgment += 1
        if (issue.code === 'multi_select_detected') multi += 1
        if (issue.code === 'missing_figure_or_table') figure += 1
        if (issue.code === 'broken_stem') broken += 1
      })
    })

    return { blockers, missingAnswer, missingAnalysis, lowQuality, judgment, multi, figure, broken }
  }, [preview, qualityMap])

  const filteredPreview = useMemo(() => {
    return preview.filter(item => {
      const fileMatched = fileFilter === 'all' || item.relativePath === fileFilter || item.fileName === fileFilter
      if (!fileMatched) return false
      const q = questionQuery.toLowerCase()
      const result = qualityMap.get(item.index)
      const matchText = !questionQuery || (
        String(item.no || '').toLowerCase().includes(q) ||
        String(item.type || '').toLowerCase().includes(q) ||
        String(item.content || '').toLowerCase().includes(q)
      )
      const hasIssues = Boolean(result?.issues.length)
      const hasBlockers = Boolean(result?.blockers.length)
      const matchIssue = !onlyIssueItems || hasIssues
      const matchBlocked = !onlyBlockedItems || hasBlockers
      return matchText && matchIssue && matchBlocked
    })
  }, [preview, questionQuery, onlyIssueItems, onlyBlockedItems, qualityMap, fileFilter])

  const fileSummaryStats = useMemo(() => {
    const parsed = fileSummaries.filter(item => item.status === 'parsed').length
    const skipped = fileSummaries.filter(item => item.status === 'skipped').length
    const withWarnings = fileSummaries.filter(item => item.warnings?.length).length
    return { parsed, skipped, withWarnings }
  }, [fileSummaries])

  const current = useMemo(() => {
    return preview.find(item => item.index === currentIndex) || preview[0] || null
  }, [preview, currentIndex])

  const currentQuality = useMemo(() => {
    if (!current) return null
    return qualityMap.get(current.index) || null
  }, [current, qualityMap])

  const selectedBlockedCount = useMemo(() => {
    return preview.filter(item => selected.includes(item.index) && isPublishBlocked(item as any)).length
  }, [preview, selected])

  const publishableCount = useMemo(() => {
    return preview.filter(item => !isPublishBlocked(item as any)).length
  }, [preview])



  function downloadTextFile(filename: string, content: string, mime = 'application/json;charset=utf-8') {
    const blob = new Blob([content], { type: mime })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }

  function exportSubset(kind: 'all' | 'selected' | 'blocked' | 'publishable') {
    const subset = preview.filter(item => {
      if (kind === 'all') return true
      if (kind === 'selected') return selected.includes(item.index)
      if (kind === 'blocked') return isPublishBlocked(item as any)
      return !isPublishBlocked(item as any)
    })
    const stamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')
    const name = `${srcName || 'import'}_${kind}_${stamp}.json`
    downloadTextFile(name, JSON.stringify(subset, null, 2))
  }

  async function exportPostPublishRepairPack() {
    const targetPaperKey = confirmResult?.paperKey || paperKey
    if (!targetPaperKey) return

    try {
      setLoadingRepairPack(true)
      const res = await fetch(`/api/import/postpublish-repair-candidates?paperKey=${encodeURIComponent(targetPaperKey)}&limit=200`)
      const data = await res.json() as { error?: string; paperKey: string; items: PostPublishRepairCandidate[]; candidateCount: number }
      if (!res.ok) throw new Error(data.error || '生成发布后修复包失败')
      const stamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')
      downloadTextFile(`${targetPaperKey}_postpublish_repair_${stamp}.json`, JSON.stringify(data, null, 2))
    } catch (error: any) {
      alert(error?.message || '生成发布后修复包失败')
    } finally {
      setLoadingRepairPack(false)
    }
  }


  async function applyPostPublishRepair() {
    const targetKey = confirmResult?.paperKey || paperKey
    if (!targetKey) return
    try {
      setApplyingPublishRepair(true)
      setPostPublishRepairApply(null)
      const res = await fetch('/api/import/postpublish-repair-apply', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ paperKey: targetKey, limit: 200, onlyBlocked: true }),
      })
      const data = await res.json() as PostPublishRepairApplyResult & { error?: string }
      if (!res.ok) throw new Error(data.error || '发布后自动修复失败')
      setPostPublishRepairApply(data)
      await runPostPublishAudit(targetKey)
    } catch (error: any) {
      alert(error?.message || '发布后自动修复失败')
    } finally {
      setApplyingPublishRepair(false)
    }
  }

  async function runPostPublishAudit(nextPaperKey?: string) {
    const targetKey = nextPaperKey || confirmResult?.paperKey || paperKey
    if (!targetKey) return
    setAuditingPublish(true)
    try {
      const res = await fetch(`/api/import/postpublish-audit?paperKey=${encodeURIComponent(targetKey)}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || '发布后抽查失败')
      setPostPublishAudit(data)
    } catch (error: any) {
      alert(error?.message || '发布后抽查失败')
    } finally {
      setAuditingPublish(false)
    }
  }

  const originalContextItems = useMemo(() => {
    if (!current) return []
    const currentPos = preview.findIndex(item => item.index === current.index)
    if (currentPos === -1) return []
    const start = Math.max(0, currentPos - 2)
    const end = Math.min(preview.length, currentPos + 3)
    return preview.slice(start, end)
  }, [preview, current])

  const currentSuggestions = useMemo(() => {
    if (!current) return []
    return buildProofSuggestions({
      index: current.index,
      no: current.no,
      content: current.content,
      options: current.options,
      answer: current.answer,
      type: current.type,
      analysis: current.analysis,
      rawText: current.rawText,
    })
  }, [current])

  useEffect(() => {
    if (preview.length && !preview.some(item => item.index === currentIndex)) {
      setCurrentIndex(preview[0].index)
    }
  }, [preview, currentIndex])

  useEffect(() => {
    if (jobPage > totalJobPages) setJobPage(totalJobPages)
  }, [jobPage, totalJobPages])

  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!dirty) return
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [dirty])

  useEffect(() => {
    if (!dirty || !importJobId || !preview.length) return
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current)
    autoSaveTimer.current = setTimeout(() => {
      handleSaveReview(true).catch(() => {})
    }, 1200)
    return () => {
      if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current)
    }
  }, [preview, dirty, importJobId])

  useEffect(() => {
    if (!preview.length) return
    const timer = setTimeout(() => {
      runPrecheck().catch(() => {})
    }, 400)
    return () => clearTimeout(timer)
  }, [inferredMeta.srcYear, inferredMeta.srcProvince, inferredMeta.examType, srcSession])

  useEffect(() => {
    if (!preview.length) {
      setPrepublish(null)
      return
    }
    const timer = setTimeout(() => {
      fetch('/api/import/prepublish', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ items: preview }),
      }).then(res => res.json()).then(data => setPrepublish(data)).catch(() => {})
    }, 300)
    return () => clearTimeout(timer)
  }, [preview])

  useEffect(() => {
    if (!current) return
    const el = originalRefs.current[current.index]
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [currentIndex, originalContextItems.length])

  async function loadJobs() {
    const res = await fetch('/api/import/jobs')
    const data = await res.json()
    setJobs(data.items || [])
  }

  useEffect(() => { loadJobs().catch(() => {}) }, [])
  useEffect(() => {
    const input = folderInputRef.current
    if (!input) return
    input.setAttribute('webkitdirectory', '')
    input.setAttribute('directory', '')
  }, [])


  useEffect(() => {
    if (bootstrappedByQuery) return
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    const loadJobId = params.get('loadJobId')
    const focusIndex = params.get('focusIndex')
    const readyToPublish = params.get('readyToPublish')
    if (!loadJobId) {
      setBootstrappedByQuery(true)
      return
    }
    loadJobDetail(loadJobId).then(() => {
      if (focusIndex) setCurrentIndex(Number(focusIndex))
      if (readyToPublish === '1') setReadyToPublishHint(true)
      setBootstrappedByQuery(true)
    }).catch(() => setBootstrappedByQuery(true))
  }, [bootstrappedByQuery])

  async function runPrecheck(meta?: { srcYear?: string; srcProvince?: string; examType?: string; srcSession?: string }) {
    setPrechecking(true)
    const body = {
      srcYear: meta?.srcYear ?? inferredMeta.srcYear ?? '',
      srcProvince: meta?.srcProvince ?? inferredMeta.srcProvince ?? '',
      examType: meta?.examType ?? inferredMeta.examType ?? examType,
      srcSession: meta?.srcSession ?? srcSession ?? '',
    }
    const res = await fetch('/api/import/precheck', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await res.json()
    setPrechecking(false)
    if (res.ok) setPrecheck(data)
  }

  function markDirty() { setDirty(true) }

  function toggleSelected(index: number) {
    setSelected(prev => prev.includes(index) ? prev.filter(item => item !== index) : [...prev, index]); markDirty()
  }
  function toggleErrorPick(index: number) {
    setAddToErrors(prev => prev.includes(index) ? prev.filter(item => item !== index) : [...prev, index]); markDirty()
  }
  function updateQuestion(index: number, patch: Partial<PreviewItem>) {
    setPreview(prev => prev.map(item => {
      if (item.index !== index) return item
      const next = { ...item, ...patch }
      if (!patch.type) next.type = inferQuestionType(next as any)
      return next
    })); markDirty()
  }
  function updateOption(index: number, optionIndex: number, value: string) {
    setPreview(prev => prev.map(item => {
      if (item.index !== index) return item
      const nextOptions = emptyOptionsTo4(item.options)
      nextOptions[optionIndex] = value
      const next = { ...item, options: nextOptions }
      next.type = inferQuestionType(next as any)
      return next
    })); markDirty()
  }

  function applySuggestion(suggestion: ProofSuggestion) {
    if (!current || !suggestion.patch) return
    updateQuestion(current.index, {
      content: suggestion.patch.content ?? current.content,
      answer: suggestion.patch.answer ?? current.answer,
      analysis: suggestion.patch.analysis ?? current.analysis,
      options: suggestion.patch.options ?? current.options,
    })
  }

  function selectAll() { setSelected(preview.map(item => item.index)); markDirty() }
  function clearAllSelected() { setSelected([]); markDirty() }
  function addAllErrors() { setAddToErrors(preview.map(item => item.index)); markDirty() }
  function clearAllErrors() { setAddToErrors([]); markDirty() }
  function deselectBlockedItems() {
    setSelected(prev => prev.filter(index => {
      const item = preview.find(row => row.index === index)
      return item ? !isPublishBlocked(item as any) : false
    }))
    markDirty()
  }
  function autoFixTypes() {
    setPreview(prev => prev.map(item => normalizePreviewItem(item)))
    markDirty()
  }

  function handleAutoFixBatch() {
    const result = autoFixBatch(preview as any)
    setPreview(result.items.map(item => normalizePreviewItem(item as any)))
    setSelected(result.recommendedIndexes)
    setAutoFixStats(result.stats)
    setCurrentIndex(result.items[0]?.index ?? 0)
    markDirty()
  }

  function selectRecommendedPublish() {
    if (prepublish?.recommendedIndexes?.length) {
      setSelected(prepublish.recommendedIndexes)
      markDirty()
    }
  }
  function selectProblemItems() {
    if (prepublish?.blockedQuestions?.length) {
      const indexes = prepublish.blockedQuestions.map(item => item.index)
      if (indexes.length) setCurrentIndex(indexes[0])
      setOnlyBlockedItems(true)
    }
  }

  function applyBatchType() {
    setPreview(prev => prev.map(item => selected.includes(item.index) ? { ...item, type: batchType } : item)); markDirty()
  }
  function clearAnalysisForSelected() {
    setPreview(prev => prev.map(item => selected.includes(item.index) ? { ...item, analysis: '' } : item)); markDirty()
  }

  async function moveCurrent(delta: number) {
    if (!current) return
    if (dirty && importJobId) await handleSaveReview(true)
    const order = filteredPreview.map(item => item.index)
    const pos = order.indexOf(current.index)
    if (pos === -1) return
    const nextPos = pos + delta
    if (nextPos < 0 || nextPos >= order.length) return
    setCurrentIndex(order[nextPos])
  }

  function handleSingleFileChange(nextFile: File | null) {
    setFile(nextFile)
    setBatchFiles(nextFile ? [nextFile] : [])
    setBatchMode('single')
  }

  function handleMultiFileChange(list: FileList | null, mode: 'multi' | 'folder' = 'multi') {
    const nextFiles = Array.from(list || [])
    setBatchFiles(nextFiles)
    setFile(nextFiles[0] || null)
    setBatchMode(mode)
  }

  async function handleUpload() {
    const filesToUpload = batchFiles.length ? batchFiles : file ? [file] : []
    if (!filesToUpload.length) return
    setLoading(true)
    setConfirmResult(null)
    setPostPublishAudit(null)
    setPostPublishRepairApply(null)
    setPrecheck(null)

    const formData = new FormData()
    if (filesToUpload.length === 1 && batchMode === 'single') {
      formData.append('file', filesToUpload[0])
    } else {
      filesToUpload.forEach(item => {
        formData.append('files', item)
        formData.append('relativePaths', (item as any).webkitRelativePath || item.name)
      })
    }
    formData.append('examType', examType)
    formData.append('srcName', srcName)

    const res = await fetch('/api/import/upload', { method: 'POST', body: formData })
    const data = await res.json()
    setLoading(false)
    if (!res.ok) {
      alert(data.error || '上传失败')
      return
    }

    const nextPreview = (data.preview || []).map((item: PreviewItem) => normalizePreviewItem({
      ...item,
      analysis: item.hasAnalysis ? '已解析，入库时保留原文' : '',
    }))

    const nextMeta = data.inferredMeta || {}
    setWarnings([
      data.isBatch ? `本次为批量导入：共 ${data.batchFileCount || filesToUpload.length} 个文件。` : '当前为单文件导入。',
      '系统会优先根据文件名自动识别 年份 / 省份 / 考试类型 / 场次 / 卷别 / 岗位线索；识别不准时再人工修正。',
      '导入质量门禁已启用：会拦截残题、缺图/缺表题、判断题误判、多选误判、选项异常。',
      '覆盖 = 更新原题内容，保留 question.id 不变。',
      ...(data.warnings || []),
    ])
    setPreview(nextPreview)
    setFileSummaries(data.fileSummaries || [])
    setFileFilter('all')
    setPayload(data.payload || '')
    setImportJobId(data.importJobId || '')
    setSelected(nextPreview.filter((item: PreviewItem) => !isPublishBlocked(item as any)).map((item: PreviewItem) => item.index))
    setAddToErrors([])
    setInferredMeta(nextMeta)
    setExamType(nextMeta.examType || examType)
    setSrcSession(nextMeta.srcSession || '')
    setCurrentIndex(nextPreview[0]?.index ?? 0)
    setDirty(false)
    setLastSavedAt('')
    setAutoFixStats(null)
    setAutoFixStats(null)
    await runPrecheck(nextMeta).catch(() => {})
    loadJobs().catch(() => {})
  }

  async function loadJobDetail(id: string) {
    if (dirty && importJobId) await handleSaveReview(true)
    setDetailLoading(true)
    const res = await fetch(`/api/import/jobs/${id}`)
    const data = await res.json()
    setDetailLoading(false)
    if (!res.ok) {
      alert(data.error || '读取导入任务失败')
      return
    }
    const parsed = data.job?.parsedQuestions || []
    const nextPreview = parsed.map((item: any, idx: number) => normalizePreviewItem({
      index: item.index ?? idx,
      no: item.no || String(idx + 1),
      content: item.content || '',
      questionImage: item.questionImage || '',
      options: item.options || [],
      answer: item.answer || '',
      type: item.type || '单项选择题',
      analysis: item.analysis || '',
      hasAnalysis: Boolean(item.analysis),
      rawText: item.rawText || '',
      fileName: item.fileName || '',
      relativePath: item.relativePath || '',
    }))
    setImportJobId(data.job?.id || '')
    setPreview(nextPreview)
    setFileSummaries(data.fileSummaries || [])
    setFileFilter('all')
    setSelected(nextPreview.filter((item: any) => !isPublishBlocked(item as any)).map((item: any) => item.index))
    setWarnings([`已加载导入任务：${data.job?.filename || ''}`])
    const summaryMap = new Map<string, FileSummaryItem>()
    nextPreview.forEach((item: PreviewItem) => {
      const key = item.relativePath || item.fileName || `file_${item.index}`
      if (!summaryMap.has(key)) {
        summaryMap.set(key, {
          fileName: item.fileName || item.relativePath || `file_${item.index}`,
          relativePath: item.relativePath || '',
          total: 0,
          warnings: [],
          status: 'parsed',
        })
      }
    })
    const nextFileSummaries = Array.from(summaryMap.values()).map(summary => ({
      ...summary,
      total: nextPreview.filter((item: PreviewItem) => (item.relativePath || item.fileName || '') === (summary.relativePath || summary.fileName || '')).length,
    }))
    setFileSummaries(nextFileSummaries)
    setFileFilter('all')
    setPayload('')
    setConfirmResult(null)
    setPostPublishAudit(null)
    setPostPublishRepairApply(null)
    setCurrentIndex(nextPreview[0]?.index ?? 0)
    setDirty(false)
    setLastSavedAt('')
  }

  async function deleteJob(id: string, filename: string) {
    const ok = window.confirm(`确认删除导入任务：${filename}？`)
    if (!ok) return
    setDeletingJobId(id)
    const res = await fetch(`/api/import/jobs/${id}`, { method: 'DELETE' })
    const data = await res.json().catch(() => ({}))
    setDeletingJobId('')
    if (!res.ok) {
      alert(data.error || '删除失败')
      return
    }
    if (importJobId === id) {
      setImportJobId('')
      setPreview([])
      setSelected([])
      setAddToErrors([])
      setWarnings([])
      setPayload('')
      setConfirmResult(null)
      setCurrentIndex(0)
      setDirty(false)
      setLastSavedAt('')
      setPrecheck(null)
    }
    loadJobs().catch(() => {})
  }

  async function handleSaveReview(silent = false) {
    if (!importJobId) {
      if (!silent) alert('当前预览没有导入任务 ID，无法保存校对')
      return
    }
    setSavingReview(true)
    const res = await fetch(`/api/import/jobs/${importJobId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        parsedQuestions: preview.map(item => ({
          index: item.index,
          no: item.no,
          content: item.content,
          questionImage: item.questionImage || '',
          options: (item.options || []).filter(Boolean),
          answer: item.answer,
          type: item.type,
          analysis: item.analysis || '',
          rawText: item.rawText || '',
          fileName: item.fileName || '',
          relativePath: item.relativePath || '',
        })),
      }),
    })
    const data = await res.json()
    setSavingReview(false)
    if (!res.ok) {
      if (!silent) alert(data.error || '保存校对失败')
      return
    }
    setDirty(false)
    setLastSavedAt(new Date().toLocaleTimeString())
    if (!silent) alert('校对内容已保存')
    loadJobs().catch(() => {})
  }

  async function handleConfirm() {
    if (selectedBlockedCount > 0) {
      alert(`当前仍有 ${selectedBlockedCount} 道阻断题被选中。请先修复，或点击“取消选择所有阻断题”。`)
      return
    }
    if (dirty && importJobId) await handleSaveReview(true)
    const body: any = {
      selected,
      addToErrors,
      srcYear: inferredMeta.srcYear || '',
      srcProvince: inferredMeta.srcProvince || '',
      examType: inferredMeta.examType || examType,
      srcSession,
      srcOrigin,
      duplicateMode,
    }
    if (importJobId) body.importJobId = importJobId
    else body.payload = payload
    const res = await fetch('/api/import/confirm', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await res.json()
    if (!res.ok) {
      alert(data.error || '导入确认失败')
      return
    }
    setConfirmResult(data)
    loadJobs().catch(() => {})
  }

  return (
    <main className="mx-auto max-w-[1750px] p-6">
      <h1 className="text-2xl font-semibold">真题导入</h1>

      <section className="mt-6 rounded-2xl border bg-white p-4 shadow-sm">
        <div className="mb-4 flex flex-wrap gap-3">
          <Link href="/import/repair-queue" className="rounded-xl border px-4 py-2 text-sm">查看待修复池</Link>
        </div>
        <div className="grid gap-3 md:grid-cols-4">
          <div className="space-y-2">
            <input type="file" accept=".docx,.json,.txt,.md,.png,.jpg,.jpeg,.bmp,.webp" onChange={e => handleSingleFileChange(e.target.files?.[0] || null)} className="rounded-xl border px-3 py-2" />
            <div className="flex flex-wrap gap-2">
              <input type="file" multiple accept=".docx,.json,.txt,.md,.png,.jpg,.jpeg,.bmp,.webp" onChange={e => handleMultiFileChange(e.target.files, 'multi')} className="rounded-xl border px-3 py-2 text-sm" />
              <input ref={folderInputRef} type="file" multiple onChange={e => handleMultiFileChange(e.target.files, 'folder')} className="hidden" />
              <button type="button" onClick={() => folderInputRef.current?.click()} className="rounded-xl border px-3 py-2 text-sm">选择文件夹批量上传</button>
            </div>
            <p className="text-xs text-slate-500">支持单文件、多个文件，或直接选择一个文件夹整批上传。优先 docx；格式不稳时可用 json / txt 兜底。</p>
            <p className="text-xs text-slate-500">当前选择：{batchFiles.length ? `${batchFiles.length} 个文件（${batchMode === 'folder' ? '文件夹模式' : batchMode === 'multi' ? '多文件模式' : '单文件模式'}）` : file ? file.name : '未选择文件'}</p>
          </div>
          <select value={examType} onChange={e => setExamType(e.target.value)} className="rounded-xl border px-3 py-2">
            <option value="guo_kao">国考</option>
            <option value="sheng_kao">省考</option>
            <option value="tong_kao">联考/统考</option>
            <option value="common">通用</option>
          </select>
          <input value={srcName} onChange={e => setSrcName(e.target.value)} placeholder="来源名称（可选，优先用文件名自动识别）" className="rounded-xl border px-3 py-2" />
          <button onClick={handleUpload} disabled={(!file && !batchFiles.length) || loading} className="rounded-xl bg-black px-4 py-2 text-white disabled:opacity-50">
            {loading ? '解析中...' : '上传并解析'}
          </button>
        </div>
      </section>

      {precheck ? (
        <section className={`mt-4 rounded-2xl border p-4 text-sm ${precheck.duplicated ? 'bg-amber-50 text-amber-900' : 'bg-green-50 text-green-800'}`}>
          <div className="flex items-center justify-between gap-3">
            <p>{precheck.message}</p>
            <button onClick={() => runPrecheck().catch(() => {})} disabled={prechecking} className="rounded-lg border px-3 py-1 text-xs disabled:opacity-50">
              {prechecking ? '检查中...' : '重新检查'}
            </button>
          </div>
          <div className="mt-2 flex flex-wrap gap-4">
            <span>历史题目：{precheck.matchedQuestions}</span>
            <span>历史导入任务：{precheck.matchedImportJobs}</span>
            <span>当前策略：{duplicateMode}</span>
          </div>
          {precheck.duplicated ? <p className="mt-2">当前“覆盖”含义：更新原题内容，保留 `question.id` 不变。</p> : null}
        </section>
      ) : null}

      {readyToPublishHint ? (
        <section className="mt-4 rounded-2xl border bg-green-50 p-4 text-sm text-green-800">
          <p className="font-medium">当前任务已无阻断题，可继续确认入库并进入练习链路。</p>
        </section>
      ) : null}


      {fileSummaries.length ? (
        <section className="mt-4 rounded-2xl border bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-medium">批量文件结果</h2>
              <p className="mt-1 text-sm text-slate-500">先看哪几个文件解析正常、哪几个文件被跳过，再决定今晚先修哪批。</p>
            </div>
            <div className="flex flex-wrap gap-3 text-sm text-slate-600">
              <span>文件数：{fileSummaries.length}</span>
              <span>解析成功：{fileSummaryStats.parsed}</span>
              <span>跳过：{fileSummaryStats.skipped}</span>
              <span>带警告：{fileSummaryStats.withWarnings}</span>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <button onClick={() => setFileFilter('all')} className={`rounded-full border px-3 py-1 text-sm ${fileFilter === 'all' ? 'border-black bg-black text-white' : ''}`}>全部题目</button>
            {fileSummaries.map(item => {
              const key = item.relativePath || item.fileName
              const active = fileFilter === key
              return <button key={key} onClick={() => setFileFilter(active ? 'all' : key)} className={`rounded-full border px-3 py-1 text-sm ${active ? 'border-black bg-black text-white' : ''}`}>
                {(item.relativePath || item.fileName).slice(0, 48)} · {item.total}
              </button>
            })}
          </div>
          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            {fileSummaries.map(item => {
              const key = item.relativePath || item.fileName
              return <div key={key} className={`rounded-xl border p-3 text-sm ${item.status === 'skipped' ? 'border-red-200 bg-red-50' : 'border-slate-200 bg-slate-50'}`}>
                <div className="flex items-center justify-between gap-3">
                  <p className="font-medium break-all">{item.relativePath || item.fileName}</p>
                  <span className="rounded-full border bg-white px-2 py-0.5 text-xs">{item.status}</span>
                </div>
                <p className="mt-2 text-slate-600">解析题数：{item.total}</p>
                {item.warnings?.length ? <div className="mt-2 grid gap-1 text-xs text-slate-600">{item.warnings.slice(0, 4).map((warning, idx) => <p key={idx}>- {warning}</p>)}</div> : <p className="mt-2 text-xs text-slate-500">无额外警告</p>}
              </div>
            })}
          </div>
        </section>
      ) : null}

      {preview.length ? (
        <section className="mt-4 rounded-2xl border bg-red-50 p-4 text-sm text-red-800">
          <div className="flex flex-wrap items-center gap-4">
            <span>总题数：{preview.length}</span>
            <span>可发布：{publishableCount}</span>
            <span>阻断题：{issueStats.blockers}</span>
            <span>判断题识别：{issueStats.judgment}</span>
            <span>多选识别：{issueStats.multi}</span>
            <span>缺图/缺表：{issueStats.figure}</span>
            <span>题干残缺：{issueStats.broken}</span>
          </div>
          <div className="mt-3 flex flex-wrap gap-3">
            <button onClick={deselectBlockedItems} className="rounded-xl border border-red-300 px-4 py-2 text-sm">取消选择所有阻断题</button>
            <button onClick={autoFixTypes} className="rounded-xl border border-red-300 px-4 py-2 text-sm">自动修正识别题型</button>
            <button onClick={handleAutoFixBatch} className="rounded-xl border border-red-300 px-4 py-2 text-sm">一键自动修复本批</button>
            <button onClick={selectRecommendedPublish} className="rounded-xl border border-red-300 px-4 py-2 text-sm">选中建议发布题</button>
            <button onClick={selectProblemItems} className="rounded-xl border border-red-300 px-4 py-2 text-sm">定位问题题</button>
            <Link href="/import/repair-queue" className="rounded-xl border border-red-300 px-4 py-2 text-sm">进入待修复池</Link>
          </div>
        </section>
      ) : null}

      <section className="mt-4 rounded-2xl border bg-slate-50 p-4 text-sm">
        <div className="grid gap-3 md:grid-cols-6">
          <input value={inferredMeta.srcYear || ''} onChange={e => { const v = e.target.value; setInferredMeta(prev => ({ ...prev, srcYear: v })); markDirty() }} placeholder="年份（自动识别，可手改）" className="rounded-xl border px-3 py-2" />
          <input value={inferredMeta.srcProvince || ''} onChange={e => { const v = e.target.value; setInferredMeta(prev => ({ ...prev, srcProvince: v })); markDirty() }} placeholder="省份（自动识别，可手改）" className="rounded-xl border px-3 py-2" />
          <select value={inferredMeta.examType || examType} onChange={e => { const v = e.target.value; setInferredMeta(prev => ({ ...prev, examType: v })); markDirty() }} className="rounded-xl border px-3 py-2">
            <option value="guo_kao">国考</option>
            <option value="sheng_kao">省考</option>
            <option value="tong_kao">联考/统考</option>
            <option value="common">通用</option>
          </select>
          <input value={srcSession} onChange={e => { setSrcSession(e.target.value); markDirty() }} placeholder="场次/季次（自动识别，可手改）" className="rounded-xl border px-3 py-2" />
          <input value={srcOrigin} onChange={e => { setSrcOrigin(e.target.value); markDirty() }} placeholder="来源标记" className="rounded-xl border px-3 py-2" />
          <select value={duplicateMode} onChange={e => setDuplicateMode(e.target.value as any)} className="rounded-xl border px-3 py-2">
            <option value="skip">重复跳过</option>
            <option value="replace_low_quality">低质量替换（推荐）</option>
            <option value="force_replace">强制覆盖</option>
          </select>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-4">
          <p>推荐 paperKey：<span className="font-mono">{paperKey}</span></p>
          <p>当前选中：{selected.length}</p>
          <p>选中阻断题：{selectedBlockedCount}</p>
          <p>加入错题本：{addToErrors.length}</p>
          <p>预览总数：{preview.length}</p>
          <p className={dirty ? 'text-amber-700' : 'text-green-700'}>{dirty ? '有未保存改动' : '已保存'}</p>
          {lastSavedAt ? <p className="text-slate-500">上次保存：{lastSavedAt}</p> : null}
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {inferredMeta.srcSession ? <span className="rounded-full border bg-white px-3 py-1">场次：{inferredMeta.srcSession}</span> : null}
          {inferredMeta.srcPaperCode ? <span className="rounded-full border bg-white px-3 py-1">卷别：{inferredMeta.srcPaperCode}</span> : null}
          {inferredMeta.postHint ? <span className="rounded-full border bg-white px-3 py-1">岗位：{inferredMeta.postHint}</span> : null}
        </div>
      </section>

      <section className="mt-4 rounded-2xl border bg-white p-4 shadow-sm">
        <div className="flex flex-wrap gap-3">
          <button onClick={selectAll} className="rounded-xl border px-3 py-2 text-sm">全选入库</button>
          <button onClick={clearAllSelected} className="rounded-xl border px-3 py-2 text-sm">全不选</button>
          <button onClick={addAllErrors} className="rounded-xl border px-3 py-2 text-sm">批量加入错题本（次要）</button>
          <button onClick={clearAllErrors} className="rounded-xl border px-3 py-2 text-sm">清空错题本标记</button>
          <button onClick={() => setOnlyIssueItems(prev => !prev)} className="rounded-xl border px-3 py-2 text-sm">
            {onlyIssueItems ? '显示全部题' : '只看问题题'}
          </button>
          <button onClick={() => setOnlyBlockedItems(prev => !prev)} className="rounded-xl border px-3 py-2 text-sm">
            {onlyBlockedItems ? '显示全部题' : '只看阻断题'}
          </button>
          <select value={batchType} onChange={e => setBatchType(e.target.value)} className="rounded-xl border px-3 py-2 text-sm">
            <option value="单项选择题">单项选择题</option>
            <option value="多项选择题">多项选择题</option>
            <option value="判断题">判断题</option>
            <option value="判断推理">判断推理</option>
            <option value="言语理解">言语理解</option>
            <option value="资料分析">资料分析</option>
          </select>
          <button onClick={applyBatchType} className="rounded-xl border px-3 py-2 text-sm">批量设置题型</button>
          <button onClick={clearAnalysisForSelected} className="rounded-xl border px-3 py-2 text-sm">清空所选解析</button>
        </div>
        <div className="mt-3 flex flex-wrap gap-3 text-sm text-slate-600">
          <span>缺答案：{issueStats.missingAnswer}</span>
          <span>缺解析：{issueStats.missingAnalysis}</span>
          <span>低质量：{issueStats.lowQuality}</span>
          <span>阻断题：{issueStats.blockers}</span>
          {prepublish ? <span>建议发布：{prepublish.publishableCount}</span> : null}
        </div>
        {autoFixStats ? <div className="mt-3 rounded-xl border bg-green-50 p-3 text-sm text-green-800">
          <p className="font-medium">自动修复结果</p>
          <div className="mt-2 flex flex-wrap gap-3">
            <span>题干清洗：{autoFixStats.contentCleaned}</span>
            <span>补答案：{autoFixStats.answerFilled}</span>
            <span>补解析：{autoFixStats.analysisFilled}</span>
            <span>补选项：{autoFixStats.optionsRecovered}</span>
            <span>题型修正：{autoFixStats.typeAdjusted}</span>
            <span>判断题归一：{autoFixStats.judgmentNormalized}</span>
            <span>言语题干裁剪：{autoFixStats.verbalStemTrimmed}</span>
            <span>数量题识别：{autoFixStats.quantityTypeAdjusted}</span>
            <span>资料题干恢复：{autoFixStats.dataStemRecovered}</span>
            <span>重排题号：{autoFixStats.renumbered}</span>
            <span>剔重：{autoFixStats.duplicatesRemoved}</span>
          </div>
        </div> : null}
        {prepublish ? <div className="mt-3 rounded-xl border bg-slate-50 p-3 text-sm">
          <div className="flex flex-wrap gap-4">
            <span>总题数：{prepublish.total}</span>
            <span>建议发布：{prepublish.publishableCount}</span>
            <span>阻断：{prepublish.blockedCount}</span>
            <span>警告：{prepublish.warningCount}</span>
          </div>
          {prepublish.blockedQuestions?.length ? <div className="mt-2 grid gap-1 text-xs text-slate-600">{prepublish.blockedQuestions.slice(0, 8).map(item => <p key={item.index}>#{item.no} {item.type}：{item.issues.join('、')}</p>)}</div> : null}
        </div> : null}
      </section>

      <section className="mt-6 grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)_450px]">
        <aside className="rounded-2xl border bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-medium">题目导航</h2>
            <span className="text-sm text-slate-500">{filteredPreview.length} 题</span>
          </div>

          <input value={questionQuery} onChange={e => setQuestionQuery(e.target.value)} placeholder="搜索题号 / 题型 / 题干" className="mt-4 w-full rounded-xl border px-3 py-2 text-sm" />

          <div className="mt-4 grid gap-2 max-h-[780px] overflow-auto pr-1">
            {filteredPreview.map(item => {
              const isCurrent = current?.index === item.index
              const isSelected = selected.includes(item.index)
              const isErrorPick = addToErrors.includes(item.index)
              const result = qualityMap.get(item.index)
              return (
                <button key={item.index} onClick={() => setCurrentIndex(item.index)} className={`rounded-xl border p-3 text-left ${isCurrent ? 'border-black bg-slate-50' : 'border-slate-200'}`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">#{item.no}</span>
                    <div className="flex gap-1">
                      {isSelected ? <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] text-blue-700">入库</span> : null}
                      {isErrorPick ? <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] text-red-700">错题</span> : null}
                    </div>
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs text-slate-600">{item.content}</p>
                  <p className="mt-1 text-[11px] text-slate-500">{item.type}</p>
                  {result?.issues?.length ? (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {result.issues.slice(0, 3).map(issue => (
                        <span key={issue.code} className={`rounded-full px-2 py-0.5 text-[10px] ${issueBadge(issue)}`}>{issue.label}</span>
                      ))}
                    </div>
                  ) : null}
                </button>
              )
            })}
            {!filteredPreview.length ? <p className="text-sm text-slate-500">暂无匹配题目</p> : null}
          </div>
        </aside>

        <section className="rounded-2xl border bg-white p-4 shadow-sm">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-medium">当前题校对</h2>
            <div className="flex flex-wrap gap-3">
              {importJobId ? <Link href={`/import/${importJobId}`} className="rounded-xl border px-4 py-2 text-sm">查看详情页</Link> : null}
              <button onClick={() => moveCurrent(-1)} disabled={!current} className="rounded-xl border px-4 py-2 text-sm disabled:opacity-50">上一题</button>
              <button onClick={() => moveCurrent(1)} disabled={!current} className="rounded-xl border px-4 py-2 text-sm disabled:opacity-50">下一题</button>
              <button onClick={() => handleSaveReview(false)} disabled={!preview.length || savingReview} className="rounded-xl border px-4 py-2 text-sm disabled:opacity-50">
                {savingReview ? '保存中...' : '保存校对'}
              </button>
              <button onClick={() => exportSubset('blocked')} disabled={!preview.length} className="rounded-xl border px-4 py-2 text-sm disabled:opacity-50">导出问题题 JSON</button>
              <button onClick={() => exportSubset('publishable')} disabled={!preview.length} className="rounded-xl border px-4 py-2 text-sm disabled:opacity-50">导出建议发布 JSON</button>
              {preview.length ? <button onClick={handleConfirm} className="rounded-xl bg-blue-600 px-4 py-2 text-white">确认入库</button> : null}
            </div>
          </div>

          {confirmResult ? <div className="mb-4 rounded-xl border bg-green-50 p-3 text-sm">
            <div className="flex flex-wrap items-center gap-3">
              <span>已入库：{confirmResult.imported}</span>
              <span>跳过：{confirmResult.skipped}</span>
              <span>覆盖：{confirmResult.overwritten}</span>
              <span>失败：{confirmResult.failed}</span>
              {confirmResult.practiceHref ? <Link href={confirmResult.practiceHref} className="rounded-lg border bg-white px-3 py-1">去练习</Link> : null}
              <button onClick={() => runPostPublishAudit()} disabled={auditingPublish || !(confirmResult.paperKey || paperKey)} className="rounded-lg border bg-white px-3 py-1 disabled:opacity-50">{auditingPublish ? '抽查中...' : '发布后抽查'}</button>
              <button onClick={() => applyPostPublishRepair()} disabled={applyingPublishRepair || !(confirmResult.paperKey || paperKey)} className="rounded-lg border bg-white px-3 py-1 disabled:opacity-50">{applyingPublishRepair ? '修复中...' : '发布后一键自动修复'}</button>
              <button onClick={() => exportPostPublishRepairPack()} disabled={loadingRepairPack || !(confirmResult.paperKey || paperKey)} className="rounded-lg border bg-white px-3 py-1 disabled:opacity-50">{loadingRepairPack ? '生成中...' : '导出发布后修复包 JSON'}</button>
            </div>
          </div> : null}

          {postPublishAudit ? <div className="mb-4 rounded-xl border bg-slate-50 p-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="font-medium">发布后抽查</p>
              <span className="text-slate-500">{postPublishAudit.paperKey}</span>
            </div>
            <div className="mt-2 flex flex-wrap gap-4 text-slate-700">
              <span>总题数：{postPublishAudit.total}</span>
              <span>阻断残留：{postPublishAudit.blockerCount}</span>
              <span>告警残留：{postPublishAudit.warningCount}</span>
              <span>重复题号：{postPublishAudit.duplicateNos.length}</span>
              <span>重复顺序：{postPublishAudit.duplicateOrders.length}</span>
            </div>
            {postPublishAudit.blockers.length ? <div className="mt-3 rounded-lg border bg-white p-3">
              <p className="font-medium text-red-700">残留阻断样本</p>
              <div className="mt-2 grid gap-1 text-xs text-slate-700">
                {postPublishAudit.blockers.slice(0, 6).map(item => <p key={item.id}>#{item.no || '-'} {item.type}：{item.issues.join('、')}</p>)}
              </div>
            </div> : null}
            <div className="mt-3 rounded-lg border bg-white p-3">
              <p className="font-medium">入库样本抽看</p>
              <div className="mt-2 grid gap-2">
                {postPublishAudit.sample.slice(0, 3).map(item => <div key={item.id} className="rounded border p-2 text-xs">
                  <p className="font-medium">#{item.no || item.order} · {item.type}</p>
                  <p className="mt-1 line-clamp-2 text-slate-700">{item.content}</p>
                  <p className="mt-1 text-slate-500">答案：{item.answer || '空'}</p>
                </div>)}
              </div>
            </div>
          </div> : null}

          {postPublishRepairApply ? <div className="mb-4 rounded-xl border bg-green-50 p-3 text-sm text-green-800">
            <div className="flex flex-wrap items-center gap-4">
              <span>发布后自动修复已执行</span>
              <span>扫描：{postPublishRepairApply.scanned}</span>
              <span>已更新：{postPublishRepairApply.updated}</span>
              <span>跳过：{postPublishRepairApply.skipped}</span>
            </div>
            {postPublishRepairApply.samples.length ? <div className="mt-2 grid gap-1 text-xs">
              {postPublishRepairApply.samples.slice(0, 6).map(item => <p key={item.id}>#{item.no}：{item.changedFields.join('、')}</p>)}
            </div> : null}
          </div> : null}

          {warnings.length ? <div className="mb-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-800">{warnings.map((item, idx) => <p key={idx}>{item}</p>)}</div> : null}

          {!current ? <p className="text-slate-500">暂无当前题目</p> : null}

          {current ? (
            <div className="grid gap-4">
              {currentQuality?.issues?.length ? (
                <div className="rounded-xl border bg-red-50 p-3 text-sm">
                  <p className="font-medium text-red-700">当前题质量门禁</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {currentQuality.issues.map(issue => (
                      <span key={issue.code} className={`rounded-full px-3 py-1 text-xs ${issueBadge(issue)}`}>{issue.label}</span>
                    ))}
                  </div>
                </div>
              ) : null}

              <div className="grid gap-3 md:grid-cols-3">
                <input value={current.no} onChange={e => updateQuestion(current.index, { no: e.target.value })} className="rounded-xl border px-3 py-2" placeholder="题号" />
                <input value={current.type} onChange={e => updateQuestion(current.index, { type: e.target.value })} className="rounded-xl border px-3 py-2" placeholder="题型" />
                <input value={current.answer} onChange={e => updateQuestion(current.index, { answer: e.target.value.toUpperCase() })} className="rounded-xl border px-3 py-2" placeholder="答案" />
              </div>
              <textarea value={current.content} onChange={e => updateQuestion(current.index, { content: e.target.value })} rows={6} className="rounded-xl border px-3 py-2" placeholder="题干（支持对照原文手动修正）" />
              {current.questionImage ? <div><p className="mb-2 text-sm text-slate-500">题图预览</p><img src={current.questionImage} alt="题图" className="max-h-80 rounded-xl border" /></div> : null}
              <div className="grid gap-2">
                {emptyOptionsTo4(current.options).map((opt, idx) => (
                  <input key={idx} value={opt} onChange={e => updateOption(current.index, idx, e.target.value)} className="rounded-xl border px-3 py-2" placeholder={`选项 ${String.fromCharCode(65 + idx)}`} />
                ))}
              </div>
              <textarea value={current.analysis || ''} onChange={e => updateQuestion(current.index, { analysis: e.target.value })} rows={5} className="rounded-xl border px-3 py-2" placeholder="解析" />
              <div className="flex gap-4 text-sm">
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={selected.includes(current.index)} onChange={() => toggleSelected(current.index)} />
                  入库
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={addToErrors.includes(current.index)} onChange={() => toggleErrorPick(current.index)} />
                  加入错题本（次要，可不勾）
                </label>
              </div>
            </div>
          ) : null}
        </section>

        <aside className="grid gap-6">
          <section className="rounded-2xl border bg-white p-4 shadow-sm">
            <h2 className="text-lg font-medium">自动校对建议</h2>
            <p className="mt-2 text-sm text-slate-500">系统会自动对比原文片段与当前解析结果，给出高/中/低置信度建议。</p>
            <div className="mt-4 grid gap-3">
              {currentSuggestions.length ? currentSuggestions.map(s => (
                <div key={s.id} className="rounded-xl border p-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-medium text-sm">{s.title}</p>
                    <span className={`rounded-full px-2 py-0.5 text-xs ${suggestionBadge(s.level)}`}>{s.level}</span>
                  </div>
                  <p className="mt-2 text-sm text-slate-600">{s.reason}</p>
                  {s.patch ? (
                    <button onClick={() => applySuggestion(s)} className="mt-3 rounded-lg border px-3 py-1 text-xs">
                      应用建议
                    </button>
                  ) : null}
                </div>
              )) : <p className="text-sm text-slate-500">当前题暂无自动校对建议。</p>}
            </div>
          </section>

          <section className="rounded-2xl border bg-white p-4 shadow-sm">
            <h2 className="text-lg font-medium">原文对照</h2>
            <p className="mt-2 text-sm text-slate-500">会自动定位到当前题附近的原文片段，减少来回翻文档。</p>
            <div className="mt-4 max-h-[340px] overflow-auto rounded-xl border bg-slate-50 p-3">
              {current && originalContextItems.length ? (
                <div className="grid gap-3">
                  {originalContextItems.map(item => {
                    const isCurrent = item.index === current.index
                    return (
                      <div
                        key={item.index}
                        ref={el => { originalRefs.current[item.index] = el }}
                        className={`rounded-xl border p-3 text-sm whitespace-pre-wrap ${isCurrent ? 'border-blue-500 bg-white shadow-sm' : 'border-slate-200 bg-white'}`}
                      >
                        <div className="mb-2 flex items-center justify-between text-xs text-slate-500">
                          <span>原文片段 · 题号 {item.no || item.index + 1}</span>
                          {isCurrent ? <span className="rounded-full bg-blue-100 px-2 py-0.5 text-blue-700">当前题</span> : null}
                        </div>
                        <div>{buildOriginalSnippet(item) || '暂无原文片段，当前先回退展示题干/选项/解析组合。'}</div>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <p className="text-sm text-slate-500">上传并解析后，这里会显示当前题附近的原文片段。</p>
              )}
            </div>
          </section>

          <section className="rounded-2xl border bg-white p-4 shadow-sm">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-medium">导入任务</h2>
              <div className="flex flex-wrap gap-3">
                <Link href="/import/release-center" className="rounded-xl border px-3 py-2 text-sm">导入发布中控台</Link>
                <button onClick={() => loadJobs()} className="rounded-xl border px-3 py-2 text-sm">刷新</button>
              </div>
            </div>

            <div className="mb-4 grid gap-3">
              <input value={jobQuery} onChange={e => { setJobQuery(e.target.value); setJobPage(1) }} placeholder="搜索文件名" className="rounded-xl border px-3 py-2 text-sm" />
              <div className="grid grid-cols-2 gap-3">
                <select value={jobStatus} onChange={e => { setJobStatus(e.target.value); setJobPage(1) }} className="rounded-xl border px-3 py-2 text-sm">
                  <option value="all">全部状态</option>
                  <option value="parsed">parsed</option>
                  <option value="reviewing">reviewing</option>
                  <option value="done">done</option>
                  <option value="done_with_errors">done_with_errors</option>
                  <option value="failed">failed</option>
                </select>
                <select value={jobSort} onChange={e => { setJobSort(e.target.value as any); setJobPage(1) }} className="rounded-xl border px-3 py-2 text-sm">
                  <option value="newest">最新优先</option>
                  <option value="oldest">最早优先</option>
                  <option value="name">按文件名</option>
                </select>
              </div>
            </div>

            {detailLoading ? <p className="text-sm text-slate-500">读取中...</p> : null}
            <div className="grid gap-3 max-h-[200px] overflow-auto pr-1">
              {pagedJobs.map(job => (
                <div key={job.id} className="rounded-xl border p-3 text-left">
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span className="font-medium">{job.filename}</span>
                    <span className={`rounded-full px-2 py-0.5 text-xs ${statusBadge(job.status)}`}>{job.status}</span>
                  </div>
                  <div className="mt-1 text-xs text-slate-500">已入库 {job.importedCount} · {new Date(job.createdAt).toLocaleString()}</div>
                  <div className="mt-3 flex gap-2">
                    <button onClick={() => loadJobDetail(job.id)} className="rounded-lg border px-3 py-1 text-xs">加载</button>
                    <Link href={`/import/${job.id}`} className="rounded-lg border px-3 py-1 text-xs">详情页</Link>
                    <Link href={`/import/repair-queue`} className="rounded-lg border px-3 py-1 text-xs">待修复池</Link>
                    <button onClick={() => deleteJob(job.id, job.filename)} disabled={deletingJobId === job.id} className="rounded-lg border px-3 py-1 text-xs text-red-700 disabled:opacity-50">
                      {deletingJobId === job.id ? '删除中...' : '删除'}
                    </button>
                  </div>
                </div>
              ))}
              {!pagedJobs.length ? <p className="text-sm text-slate-500">暂无匹配导入任务</p> : null}
            </div>

            <div className="mt-4 flex items-center justify-between text-sm text-slate-500">
              <span>第 {jobPage} / {totalJobPages} 页</span>
              <div className="flex gap-2">
                <button onClick={() => setJobPage(prev => Math.max(1, prev - 1))} disabled={jobPage <= 1} className="rounded-lg border px-3 py-1 disabled:opacity-50">上一页</button>
                <button onClick={() => setJobPage(prev => Math.min(totalJobPages, prev + 1))} disabled={jobPage >= totalJobPages} className="rounded-lg border px-3 py-1 disabled:opacity-50">下一页</button>
              </div>
            </div>
          </section>

          {confirmResult ? (
            <section className="rounded-2xl border bg-white p-4 shadow-sm">
              <h2 className="text-lg font-medium">导入结果</h2>
              <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-xl bg-slate-50 p-3">新增：{confirmResult.imported}</div>
                <div className="rounded-xl bg-slate-50 p-3">覆盖：{confirmResult.overwritten}</div>
                <div className="rounded-xl bg-slate-50 p-3">保留ID更新：{confirmResult.stableIdUpdates || 0}</div>
                <div className="rounded-xl bg-slate-50 p-3">跳过：{confirmResult.skipped}</div>
                <div className="rounded-xl bg-slate-50 p-3">失败：{confirmResult.failed}</div>
                <div className="rounded-xl bg-slate-50 p-3">低质量：{confirmResult.lowQuality}</div>
              </div>
              {confirmResult.paperKey ? (
                <div className="mt-4 rounded-xl border bg-amber-50 p-4 text-sm">
                  <p className="font-medium">已形成练习口径</p>
                  <p className="mt-2">paperKey：<span className="font-mono">{confirmResult.paperKey}</span></p>
                  <p className="mt-2 text-slate-700">下一步不要停在“导入成功”，直接进入这套卷的练习链路。</p>
                  <div className="mt-3 flex flex-wrap gap-3">
                    <Link href={confirmResult.practiceHref || '/practice'} className="rounded-xl border px-4 py-2">去练这套卷</Link>
                    <Link href={confirmResult.practiceHrefLimit20 || '/practice?limit=20'} className="rounded-xl border px-4 py-2">去练这套卷（限20题）</Link>
                    <Link href="/practice" className="rounded-xl border px-4 py-2">返回练习页</Link>
                  </div>
                </div>
              ) : null}
              {confirmResult.duplicateStrategyNote ? <p className="mt-3 text-sm text-slate-600">{confirmResult.duplicateStrategyNote}</p> : null}
              <p className="mt-2 text-sm text-slate-500">重点区分：新增了多少，更新了多少，哪些是保留原 question.id 的覆盖更新。</p>
            </section>
          ) : null}
        </aside>
      </section>
    </main>
  )
}
