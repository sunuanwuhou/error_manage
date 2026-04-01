export type ImportPreviewLike = {
  index: number
  no: string
  content: string
  options: string[]
  answer: string
  type: string
  analysis?: string
  rawText?: string
  questionImage?: string
}

export type ImportQualityIssue = {
  code:
    | 'missing_answer'
    | 'missing_analysis'
    | 'low_quality'
    | 'judgment_detected'
    | 'multi_select_detected'
    | 'missing_figure_or_table'
    | 'broken_stem'
    | 'option_count_abnormal'
    | 'judgment_answer_invalid'
    | 'multi_answer_invalid'
    | 'data_stem_too_short'
  label: string
  severity: 'info' | 'warn' | 'block'
}

export type ImportQualityResult = {
  inferredType: string
  issues: ImportQualityIssue[]
  blockers: ImportQualityIssue[]
  warnings: ImportQualityIssue[]
}

const FIGURE_PATTERNS = [/如图/, /图示/, /下图/, /图中/, /所给图形/, /表中/, /下表/, /如下表/, /统计表/]

function text(input?: string | null) {
  return String(input || '').trim()
}

export function getNonEmptyOptions(options?: string[]) {
  return (options || []).map(v => text(v)).filter(Boolean)
}

export function isJudgmentLike(item: ImportPreviewLike) {
  const options = getNonEmptyOptions(item.options)
  const answer = text(item.answer)
  const normalized = options.map(v => v.replace(/^[A-D][\.．、:：]\s*/, ''))
  const hasTrueFalseOptions =
    normalized.length >= 2 &&
    normalized[0]?.includes('正确') &&
    normalized[1]?.includes('错误')
  const answerLooksJudgment = ['正确', '错误'].includes(answer)
  return hasTrueFalseOptions || answerLooksJudgment
}

export function isMultiSelectLike(item: ImportPreviewLike) {
  const answer = text(item.answer)
  if (!answer) return false
  if (/[,，、\/]/.test(answer)) return true
  const compact = answer.replace(/\s+/g, '')
  return /^[A-D]{2,4}$/.test(compact)
}

export function inferQuestionType(item: ImportPreviewLike) {
  if (isJudgmentLike(item)) return '判断题'
  if (isMultiSelectLike(item)) return '多项选择题'
  return text(item.type) || '单项选择题'
}

export function evaluateImportQuality(item: ImportPreviewLike): ImportQualityResult {
  const issues: ImportQualityIssue[] = []
  const options = getNonEmptyOptions(item.options)
  const content = text(item.content)
  const answer = text(item.answer)
  const analysis = text(item.analysis)
  const inferredType = inferQuestionType(item)
  const source = `${content} ${text(item.rawText)}`

  if (!answer) {
    issues.push({ code: 'missing_answer', label: '缺答案', severity: 'block' })
  }

  if (!analysis) {
    issues.push({ code: 'missing_analysis', label: '缺解析', severity: 'warn' })
  }

  if (content.length < 12) {
    issues.push({ code: 'low_quality', label: '低质量', severity: 'warn' })
  }

  if (!content || content.length < 6) {
    issues.push({ code: 'broken_stem', label: '题干残缺', severity: 'block' })
  }

  if (/^（\s*）$/.test(content) || /^[，。、；：\s（）()【】\[\]-]+$/.test(content)) {
    issues.push({ code: 'broken_stem', label: '题干残缺', severity: 'block' })
  }

  const chineseChars = (content.match(/[\u4e00-\u9fa5]/g) || []).length
  if (content.length >= 8 && chineseChars <= 1) {
    issues.push({ code: 'broken_stem', label: '题干残缺', severity: 'block' })
  }

  if (isJudgmentLike(item)) {
    issues.push({ code: 'judgment_detected', label: '识别为判断题', severity: 'info' })
    if (answer && !['A', 'B', '正确', '错误'].includes(answer)) {
      issues.push({ code: 'judgment_answer_invalid', label: '判断题答案异常', severity: 'block' })
    }
  }

  if (isMultiSelectLike(item) && !isJudgmentLike(item)) {
    issues.push({ code: 'multi_select_detected', label: '识别为多选题', severity: 'warn' })
  }

  if (inferredType === '多项选择题') {
    const compact = answer.replace(/[^A-D]/g, '')
    if (!/^[A-D]{2,4}$/.test(compact)) {
      issues.push({ code: 'multi_answer_invalid', label: '多选答案异常', severity: 'block' })
    }
  }

  if (inferredType === '资料分析' && content.length < 20) {
    issues.push({ code: 'data_stem_too_short', label: '资料题题干过短', severity: 'block' })
  }

  const dependsFigureOrTable = FIGURE_PATTERNS.some(pattern => pattern.test(source))
  if (dependsFigureOrTable && !text(item.questionImage)) {
    issues.push({ code: 'missing_figure_or_table', label: '疑似缺图/缺表', severity: 'block' })
  }

  if (inferredType !== '判断题' && options.length < 4) {
    issues.push({ code: 'option_count_abnormal', label: '选项数量异常', severity: 'block' })
  }

  const blockers = issues.filter(item => item.severity === 'block')
  const warnings = issues.filter(item => item.severity !== 'block')

  return { inferredType, issues, blockers, warnings }
}

export function isPublishBlocked(item: ImportPreviewLike) {
  return evaluateImportQuality(item).blockers.length > 0
}
