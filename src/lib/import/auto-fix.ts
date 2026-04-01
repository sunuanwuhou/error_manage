import { evaluateImportQuality, inferQuestionType, type ImportPreviewLike } from '@/lib/import/quality-gate'

export type AutoFixablePreview = ImportPreviewLike & {
  questionImage?: string
  fileName?: string
  relativePath?: string
}

export type AutoFixStats = {
  total: number
  contentCleaned: number
  answerFilled: number
  analysisFilled: number
  optionsRecovered: number
  typeAdjusted: number
  renumbered: number
  duplicatesRemoved: number
  judgmentNormalized: number
  verbalStemTrimmed: number
  quantityTypeAdjusted: number
  dataStemRecovered: number
}

export type AutoFixResult<T> = {
  items: T[]
  stats: AutoFixStats
  recommendedIndexes: number[]
  problemIndexes: number[]
}

function text(input?: string | null) {
  return String(input || '').trim()
}

function uniq<T>(list: T[]) {
  return Array.from(new Set(list))
}

function normalizeAnswer(answer: string, type?: string) {
  let value = text(answer)
    .replace(/[Ａ-Ｄ]/g, s => String.fromCharCode(s.charCodeAt(0) - 65248))
    .replace(/[，、\s]+/g, '')
    .toUpperCase()

  if (!value) return ''
  if (/^(正确|对|TRUE)$/i.test(value)) return 'A'
  if (/^(错误|错|FALSE)$/i.test(value)) return 'B'
  if (/^[A-D]{1,4}$/.test(value)) {
    if (type === '多项选择题') return uniq(value.split('')).join('')
    return value[0]
  }
  const letters = value.match(/[A-D]/g) || []
  if (letters.length) {
    const merged = uniq(letters).join('')
    return type === '多项选择题' ? merged : merged[0]
  }
  return value
}

function normalizeOption(option: string, idx: number) {
  const label = String.fromCharCode(65 + idx)
  const cleaned = text(option).replace(/^[A-DＡ-Ｄ][\.．、\)）:：]\s*/i, '')
  return cleaned ? `${label}.${cleaned}` : ''
}

function cleanupContent(content: string) {
  return text(content)
    .replace(/^\s*\d{1,3}[\.．、]\s*/, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/(?:参考)?答案[:：]\s*[A-DＡ-Ｄ正确错误对错]+\s*$/i, '')
    .replace(/(?:参考)?解析[:：][\s\S]*$/i, '')
    .trim()
}

function extractAnswer(source: string, type?: string) {
  const match = String(source || '').match(/(?:参考)?答案\s*[:：]\s*([A-DＡ-Ｄ正确错误对错ABCD、,，\s]+)/i)
  return match ? normalizeAnswer(match[1], type) : ''
}

function extractAnalysis(source: string) {
  const match = String(source || '').match(/(?:参考)?解析\s*[:：]\s*([\s\S]+)$/i)
  return match ? text(match[1]) : ''
}

function splitInlineOptions(source: string) {
  const input = String(source || '').replace(/\r/g, '')
  const matches = [...input.matchAll(/([A-DＡ-Ｄ])[\.．、\)）:：]\s*([\s\S]*?)(?=(?:[A-DＡ-Ｄ][\.．、\)）:：])|$)/g)]
  if (matches.length < 2) return []
  return matches
    .map((m, idx) => normalizeOption(`${m[1]}.${text(m[2])}`, idx))
    .filter(Boolean)
}

function inferTypeByStem(item: AutoFixablePreview) {
  const source = `${text(item.content)}\n${text(item.rawText)}`
  if (/判断下列说法|判断正误|下列说法正确的是|正确的有|错误的有/.test(source) && /正确|错误|对|错/.test(source)) return '判断题'
  if (/根据以下资料|根据所给资料|所给资料|表\d|图\d|同比|环比|增长率|百分点|比重/.test(source)) return '资料分析'
  if (/填入画横线部分|最恰当的一项|词语填空|语句填空|文段/.test(source)) return '言语理解'
  if (/图形|立体图形|平面图形|所给图形|定义判断|类比推理|逻辑判断/.test(source)) return '判断推理'
  if (/工程|行程|利润|浓度|排列组合|概率|几何|方程|数列|余数|倍数|平均数|打折|售价|成本|速度/.test(source)) return '数量关系'
  return inferQuestionType(item)
}

function signatureOf(item: AutoFixablePreview) {
  const opts = (item.options || []).map(v => text(v).replace(/^[A-D][\.．、:：]\s*/i, '')).filter(Boolean).join('|')
  return `${cleanupContent(item.content)}##${opts}`
}

function ensureJudgmentOptions(item: AutoFixablePreview) {
  const options = (item.options || []).map(v => text(v).replace(/^[A-D][\.．、:：]\s*/i, ''))
  const judgmentLike =
    text(item.type) === '判断题' ||
    (options.length >= 2 && options.some(v => /正确|错误|对|错/.test(v))) ||
    /判断正误|判断下列说法/.test(`${text(item.content)} ${text(item.rawText)}`)

  if (!judgmentLike) return { changed: false, item }

  const next = { ...item }
  next.type = '判断题' as any
  next.options = ['A.正确', 'B.错误'] as any
  next.answer = normalizeAnswer(next.answer, '判断题') as any
  return { changed: true, item: next }
}

function trimStemBeforeOptions(content: string) {
  const input = text(content)
  const match = input.match(/^[\s\S]*?(?=\s*[A-DＡ-Ｄ][\.．、\)）:：])/)
  if (!match) return input
  const next = text(match[1])
  return next || input
}

function repairVerbalStem(item: AutoFixablePreview) {
  if (text(item.type) !== '言语理解') return { changed: false, item }
  const next = { ...item }
  const trimmed = trimStemBeforeOptions(next.content)
  if (trimmed && trimmed !== text(next.content)) {
    next.content = trimmed as any
    return { changed: true, item: next }
  }
  return { changed: false, item }
}

function recoverDataStem(item: AutoFixablePreview) {
  if (text(item.type) !== '资料分析') return { changed: false, item }
  const source = `${text(item.rawText)}\n${text(item.content)}`
  const match = source.match(/((?:根据以下资料|根据所给资料|所给资料|阅读下列材料)[\s\S]*?)(?=\n?\d{1,3}[\.．、]|$)/)
  if (!match) return { changed: false, item }
  const candidate = cleanupContent(match[1])
  if (!candidate || candidate.length <= text(item.content).length) return { changed: false, item }
  return { changed: true, item: { ...item, content: candidate as any } }
}

function normalizeQuantityType(item: AutoFixablePreview) {
  const source = `${text(item.content)} ${text(item.rawText)}`
  const looksQuantity = /工程|行程|利润|浓度|排列组合|概率|几何|方程|数列|余数|倍数|平均数|打折|售价|成本|速度|路程/.test(source)
    || /\d+[%％]?/.test(source) && /多少|几|求/.test(source)
  if (!looksQuantity) return { changed: false, item }
  if (text(item.type) === '数量关系') return { changed: false, item }
  const next = { ...item, type: '数量关系' as any }
  if (!/^[A-D]{2,4}$/.test(text(next.answer))) {
    next.type = '数量关系' as any
  }
  return { changed: true, item: next }
}

export function autoFixBatch<T extends AutoFixablePreview>(items: T[]): AutoFixResult<T> {
  const stats: AutoFixStats = {
    total: items.length,
    contentCleaned: 0,
    answerFilled: 0,
    analysisFilled: 0,
    optionsRecovered: 0,
    typeAdjusted: 0,
    renumbered: 0,
    duplicatesRemoved: 0,
    judgmentNormalized: 0,
    verbalStemTrimmed: 0,
    quantityTypeAdjusted: 0,
    dataStemRecovered: 0,
  }

  const fixed = items.map((item, idx) => {
    let next = { ...item } as T
    const originalType = text(next.type)
    const source = `${text(next.rawText)}\n${text(next.content)}`

    const cleanedContent = cleanupContent(next.content)
    if (cleanedContent !== text(next.content)) {
      next.content = cleanedContent as any
      stats.contentCleaned += 1
    }

    if ((!next.options || next.options.filter(Boolean).length < 2)) {
      const recovered = splitInlineOptions(`${text(next.rawText)}\n${text(next.content)}`)
      if (recovered.length >= 2) {
        next.options = recovered as any
        stats.optionsRecovered += 1
      }
    } else {
      const normalizedOptions = next.options.map((opt, optIdx) => normalizeOption(opt, optIdx)).filter(Boolean)
      if (normalizedOptions.join('|') !== (next.options || []).join('|')) {
        next.options = normalizedOptions as any
      }
    }

    const nextType = inferTypeByStem(next)
    if (nextType && nextType !== originalType) {
      next.type = nextType as any
      stats.typeAdjusted += 1
    }

    const judgmentFixed = ensureJudgmentOptions(next)
    next = judgmentFixed.item as T
    if (judgmentFixed.changed) stats.judgmentNormalized += 1

    const verbalFixed = repairVerbalStem(next)
    next = verbalFixed.item as T
    if (verbalFixed.changed) stats.verbalStemTrimmed += 1

    const dataFixed = recoverDataStem(next)
    next = dataFixed.item as T
    if (dataFixed.changed) stats.dataStemRecovered += 1

    const quantityFixed = normalizeQuantityType(next)
    next = quantityFixed.item as T
    if (quantityFixed.changed) {
      stats.quantityTypeAdjusted += 1
      if (text(next.type) !== originalType) stats.typeAdjusted += 1
    }

    if (!text(next.answer)) {
      const extractedAnswer = extractAnswer(source, text(next.type))
      if (extractedAnswer) {
        next.answer = extractedAnswer as any
        stats.answerFilled += 1
      }
    } else {
      next.answer = normalizeAnswer(next.answer, text(next.type)) as any
    }

    if (!text(next.analysis)) {
      const extractedAnalysis = extractAnalysis(source)
      if (extractedAnalysis) {
        next.analysis = extractedAnalysis as any
        stats.analysisFilled += 1
      }
    }

    if (String(next.no || '') !== String(idx + 1)) {
      next.no = String(idx + 1) as any
      stats.renumbered += 1
    }

    return next
  })

  const deduped: T[] = []
  const seen = new Set<string>()
  for (const item of fixed) {
    const sig = signatureOf(item)
    if (seen.has(sig)) {
      stats.duplicatesRemoved += 1
      continue
    }
    seen.add(sig)
    deduped.push(item)
  }

  const recommendedIndexes: number[] = []
  const problemIndexes: number[] = []
  deduped.forEach(item => {
    const gate = evaluateImportQuality(item)
    if (gate.blockers.length) problemIndexes.push(item.index)
    else recommendedIndexes.push(item.index)
  })

  return { items: deduped, stats, recommendedIndexes, problemIndexes }
}
