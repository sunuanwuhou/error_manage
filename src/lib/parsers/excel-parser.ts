// src/lib/parsers/excel-parser.ts
// ============================================================
// Excel/CSV 真题解析器
// 支持格式：
//   A: 粉笔导出格式（题目/A/B/C/D/答案/解析/题型）
//   B: 自制格式（序号/题目内容/选项A/选项B/选项C/选项D/正确答案）
//   C: 简化格式（题目/答案，无选项）
// ============================================================

// @ts-ignore Node strip-types tests need explicit .ts extensions for ESM resolution.
import type { ParsedQuestion } from './pdf-parser.ts'

// SheetJS 在运行时动态 import（避免 Edge Runtime 问题）
async function readWorkbook(buffer: Buffer) {
  const XLSX = await import('xlsx')
  return XLSX.read(buffer, { type: 'buffer', bookFiles: true })
}

// ============================================================
// 列名标准化映射
// ============================================================
const COLUMN_ALIASES: Record<string, string[]> = {
  content:  ['题目', '题目内容', '题干', '正文', '内容', 'question', 'content', '题'],
  optionA:  ['A', '选项A', '选A', 'A选项', 'option_a'],
  optionB:  ['B', '选项B', '选B', 'B选项', 'option_b'],
  optionC:  ['C', '选项C', '选C', 'C选项', 'option_c'],
  optionD:  ['D', '选项D', '选D', 'D选项', 'option_d'],
  answer:   ['答案', '正确答案', '参考答案', 'answer', '正确选项'],
  type:     ['题型', '类型', '科目', 'type'],
  skillTag: ['考点', '知识点', '模块', '部分', '标签', 'skill_tag'],
  analysis: ['解析', '解题思路', '答案解析', 'analysis', '解析说明'],
  no:       ['序号', '编号', '题号', 'no', 'id', '#'],
}

function normalizeHeader(h: string): string {
  const trimmed = String(h).trim()
  for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
    if (aliases.some(a => a.toLowerCase() === trimmed.toLowerCase())) {
      return field
    }
  }
  return trimmed.toLowerCase()
}

// ============================================================
// 主解析函数
// ============================================================
export async function parseExcelBuffer(buffer: Buffer): Promise<{
  questions: ParsedQuestion[]
  warnings:  string[]
  sheetName: string
}> {
  const warnings: string[] = []
  const wb = await readWorkbook(buffer)

  // 取第一个 Sheet
  const sheetName = wb.SheetNames[0]
  const sheet     = wb.Sheets[sheetName]

  const XLSX   = await import('xlsx')
  const rows   = XLSX.utils.sheet_to_json<Array<string | number>>(sheet, {
    header: 1,
    defval: '',
    raw:    false,
    blankrows: true,
  })

  if (rows.length === 0) {
    warnings.push('Excel 文件为空或无法读取')
    return { questions: [], warnings, sheetName }
  }

  // 规范化列名
  const headerRow = (rows[0] || []).map((cell) => String(cell ?? '').trim())
  const headerIndexes = new Map<string, number>()
  headerRow.forEach((rawKey, index) => {
    if (!rawKey) return
    headerIndexes.set(normalizeHeader(rawKey), index)
  })

  const hasOptions = headerIndexes.has('optionA')
  const hasAnswer  = headerIndexes.has('answer')
  const hasContent = headerIndexes.has('content')

  if (!hasContent) {
    warnings.push('未找到题目列（尝试列名：题目/题干/question），请检查表头')
    return { questions: [], warnings, sheetName }
  }

  if (!hasAnswer) {
    warnings.push('未找到答案列，答案将为空')
  }

  // 逐行解析
  const questions: ParsedQuestion[] = []
  let currentSectionType = ''
  let pendingMaterialImage = ''
  let pendingOptionStripImage = ''
  const imageRows = extractSheetImages(wb)

  rows.slice(1).forEach((row, idx) => {
    const actualRowNumber = idx + 2
    const get = (field: string): string => {
      const columnIndex = headerIndexes.get(field)
      if (columnIndex == null) return ''
      return String(row[columnIndex] ?? '').trim()
    }

    const content = get('content')
    const rowImages = imageRows.get(actualRowNumber) || []
    const rowImage = buildCompositeImage(rowImages)
    if ((!content || content.length < 3) && rowImages.length >= 4) {
      pendingOptionStripImage = rowImage
      return
    }
    if (!content || content.length < 3) return  // 跳过空行
    const explicitType = normalizeQuestionType(get('type'))
    const skillTag = get('skillTag')

    if (isSectionHeaderRow(get('no'), content)) {
      currentSectionType = inferExcelQuestionType({
        explicitType,
        currentSectionType: '',
        content,
        skillTag,
      })
      pendingMaterialImage = ''
      pendingOptionStripImage = ''
      return
    }

    const no = get('no') || String(idx + 1)

    // 组装选项
    const options: string[] = []
    for (const letter of ['A', 'B', 'C', 'D']) {
      const text = get(`option${letter}`)
      if (text) options.push(buildOptionLabel(text, letter, pendingOptionStripImage))
    }

    // 如果没有独立选项列，尝试从题目正文里提取
    if (options.length === 0 && content.includes('A.')) {
      const extracted = extractOptionsFromContent(content)
      options.push(...extracted.options)
    }

    const answer = normalizeAnswer(get('answer'))

    const looksLikeMaterialRow = !/^\d{1,3}$/.test(no) && !answer && (
      Boolean(rowImage) ||
      /^@t\d+$/i.test(content) ||
      /资料|材料/.test(no)
    )

    if (looksLikeMaterialRow) {
      pendingMaterialImage = rowImage || pendingMaterialImage
      return
    }

    // 跳过标题/说明行：既没有答案，也没有足够选项，且题号不合法
    if (!/^\d{1,3}$/.test(no) && !hasAnswer && options.length < 2) return
    if (!answer && options.length < 2) return

    const type     = inferExcelQuestionType({
      explicitType,
      currentSectionType,
      content,
      skillTag,
    })
    const analysis = get('analysis')
    const normalizedOptions = normalizeQuestionOptions(options, Boolean(rowImage || pendingMaterialImage || pendingOptionStripImage))
    const shouldUsePendingMaterial = Boolean(pendingMaterialImage) && (
      type === '资料分析' ||
      containsInlineImageToken(content) ||
      normalizedOptions.some(option => containsInlineImageToken(option))
    )
    const usesPendingOptionStrip = Boolean(pendingOptionStripImage) && (
      /^@t\d+$/i.test(content) ||
      normalizedOptions.every((option, optionIndex) => normalizeTextToken(option) === `${String.fromCharCode(65 + optionIndex)}.见图`)
    )
    const baseQuestionImage = rowImage || (shouldUsePendingMaterial ? pendingMaterialImage : '')
    const questionImage = usesPendingOptionStrip
      ? stackCompositeImages([baseQuestionImage, pendingOptionStripImage].filter(Boolean))
      : baseQuestionImage

    questions.push({
      no,
      content: cleanContent(content),
      questionImage,
      options: normalizedOptions,
      answer,
      type,
      analysis,
      rawText: JSON.stringify({ rowNumber: actualRowNumber, row }),
    })

    if (usesPendingOptionStrip) {
      pendingOptionStripImage = ''
    }
  })

  if (questions.length === 0) {
    warnings.push('解析后无有效题目，请检查文件格式')
  }

  return { questions, warnings, sheetName }
}

// ============================================================
// 辅助函数
// ============================================================

// 从题目正文中提取选项（部分格式把选项写在题目里）
function extractOptionsFromContent(text: string): { content: string; options: string[] } {
  const options: string[] = []
  const optionPattern = /([ABCD])[.．、\s]([^ABCD\n]{2,50})/g
  let match
  let cleanText = text

  while ((match = optionPattern.exec(text)) !== null) {
    options.push(`${match[1]}.${normalizeInlineImageToken(match[2].trim(), match[1])}`)
    cleanText = cleanText.replace(match[0], '')
  }

  return { content: cleanText.trim(), options }
}

// 清理题目正文（去掉题号前缀等）
function cleanContent(text: string): string {
  return applyKnownQuestionTextFixes(
    text
    .replace(/^【[^】]+】/, '')
    .replace(/^\d{1,3}[.、．。\s]+/, '')
    .replace(/@t\d+/gi, '[图]')
    .replace(/[A-D][.、．]\s*[^\n]{2,50}/g, '')  // 去掉混在题目里的选项
    .trim()
  )
}

function applyKnownQuestionTextFixes(text: string): string {
  if (!text) return text

  return text
    .replace(
      /每个办事窗口办理每笔业务的用时缩短到以前的(?:\[图\]|@t\d+)/gi,
      '每个办事窗口办理每笔业务的用时缩短到以前的2/3'
    )
}

function normalizeInlineImageToken(text: string, letter = ''): string {
  if (!text) return ''
  const trimmed = text.trim()
  if (/^@t\d+$/i.test(trimmed)) {
    return letter ? `[图${letter}]` : '[图]'
  }
  return trimmed.replace(/@t\d+/gi, '[图]')
}

function containsInlineImageToken(text: string): boolean {
  return /@t\d+/i.test(text)
}

function buildOptionLabel(text: string, letter: string, pendingOptionStripImage: string): string {
  const trimmed = text.trim()
  if (/^@t\d+$/i.test(trimmed)) {
    return `${letter}.见图`
  }
  if (pendingOptionStripImage && trimmed.toUpperCase() === letter) {
    return `${letter}.见图`
  }
  return `${letter}.${normalizeInlineImageToken(trimmed, letter)}`
}

function normalizeTextToken(text: string): string {
  return text.replace(/\s+/g, '').trim()
}

function normalizeQuestionOptions(options: string[], hasQuestionImage: boolean): string[] {
  return options.map((option) => {
    if (/^([A-D])\.\1$/.test(option) && hasQuestionImage) {
      return option.replace(/^([A-D])\.\1$/, '$1.见图')
    }
    if (hasQuestionImage && /\[图[A-D]?\]/.test(option)) {
      return option.replace(/\[图[A-D]?\]/g, '见图')
    }
    return option
  })
}

// 标准化答案（处理 "A" "（A）" "a" "1" 等各种格式）
function normalizeAnswer(raw: string): string {
  if (!raw) return ''
  const upper = raw.toUpperCase().replace(/[（(）)\s]/g, '')
  // 数字答案（1=A, 2=B...）
  if (/^\d$/.test(upper)) {
    return String.fromCharCode(64 + parseInt(upper))
  }
  // 取第一个 ABCD 字母
  const match = upper.match(/[ABCD]/)
  return match?.[0] ?? ''
}

function guessTypeFromText(text: string): string {
  const TYPE_KEYWORDS: Array<{ type: string; keywords: string[] }> = [
    { type: '资料分析',  keywords: ['资料分析', '综合资料', '统计图', '统计表', '增长', '比重', '图表', '万元', '亿元'] },
    { type: '数量关系',  keywords: ['数量关系', '数学运算', '数字推理', '甲乙', '工程量', '速度', '方程', '概率', '排列组合'] },
    { type: '常识判断',  keywords: ['常识判断', '法律', '宪法', '历史', '地理', '物理', '化学'] },
    { type: '言语理解',  keywords: ['言语理解', '阅读理解', '选词填空', '文段', '作者', '填入', '排序', '下列表述'] },
    { type: '判断推理',  keywords: ['判断推理', '图形推理', '定义判断', '类比推理', '逻辑判断', '所有', '有些', '如果', '假设', '结论', '强化', '削弱'] },
  ]
  for (const { type, keywords } of TYPE_KEYWORDS) {
    if (keywords.some(k => text.includes(k))) return type
  }
  return '判断推理'
}

function normalizeQuestionType(raw: string): string {
  if (!raw) return ''
  if (/资料分析/.test(raw)) return '资料分析'
  if (/数量关系|数学运算|数字推理/.test(raw)) return '数量关系'
  if (/言语理解|言语|阅读理解|选词填空/.test(raw)) return '言语理解'
  if (/常识判断|常识/.test(raw)) return '常识判断'
  if (/判断推理|逻辑判断|图形推理|定义判断|类比推理/.test(raw)) return '判断推理'
  return raw.trim()
}

function isSectionHeaderRow(no: string, content: string) {
  return !no && /第[一二三四五六七八九十\d]+部分|常识判断|言语理解与表达|数量关系|判断推理|资料分析/.test(content)
}

export function inferExcelQuestionType(params: {
  explicitType?: string
  currentSectionType?: string
  content: string
  skillTag?: string
}) {
  const { explicitType = '', currentSectionType = '', content, skillTag = '' } = params
  const normalizedExplicit = normalizeQuestionType(explicitType)
  if (normalizedExplicit) return normalizedExplicit

  const sectionHint = normalizeQuestionType(currentSectionType)
  if (sectionHint) return sectionHint

  const tagHint = normalizeQuestionType(skillTag)
  if (tagHint) return tagHint

  const merged = `${content} ${skillTag}`
  return guessTypeFromText(merged)
}

type SheetImage = {
  row: number
  col: number
  widthPx: number
  heightPx: number
  dataUrl: string
}

function extractSheetImages(workbook: any): Map<number, SheetImage[]> {
  const grouped = new Map<number, SheetImage[]>()
  const files = workbook?.files || {}
  const drawingPath = Object.keys(files).find((path) => /^xl\/drawings\/drawing\d+\.xml$/i.test(path))
  if (!drawingPath) return grouped

  const drawingXml = readZipText(files[drawingPath])
  if (!drawingXml) return grouped

  const relPath = drawingPath.replace(/\/drawing(\d+)\.xml$/i, '/_rels/drawing$1.xml.rels')
  const relXml = readZipText(files[relPath])
  const relationMap = extractImageRelations(relXml)

  const anchorPattern = /<xdr:(oneCellAnchor|twoCellAnchor)>([\s\S]*?)<\/xdr:\1>/g
  let anchorMatch: RegExpExecArray | null
  while ((anchorMatch = anchorPattern.exec(drawingXml)) !== null) {
    const block = anchorMatch[2]
    const fromRow = Number(block.match(/<xdr:row>(\d+)<\/xdr:row>/)?.[1] || -1)
    const fromCol = Number(block.match(/<xdr:col>(\d+)<\/xdr:col>/)?.[1] || 0)
    const embedId = block.match(/r:embed="([^"]+)"/)?.[1] || ''
    if (fromRow < 0 || !embedId) continue

    const target = relationMap.get(embedId)
    const imagePath = resolveDrawingTarget(drawingPath, target)
    const imageFile = imagePath ? files[imagePath] : null
    const imageBuffer = imageFile ? readZipBuffer(imageFile) : null
    if (!imageBuffer?.length) continue

    const mimeType = guessImageMimeType(imagePath)
    const widthPx = emuToPx(Number(block.match(/cx="(\d+)"/)?.[1] || 0)) || 220
    const heightPx = emuToPx(Number(block.match(/cy="(\d+)"/)?.[1] || 0)) || 160
    const image: SheetImage = {
      row: fromRow,
      col: fromCol,
      widthPx: Math.max(widthPx, 72),
      heightPx: Math.max(heightPx, 72),
      dataUrl: `data:${mimeType};base64,${imageBuffer.toString('base64')}`,
    }

    const bucket = grouped.get(image.row) || []
    bucket.push(image)
    grouped.set(image.row, bucket)
  }

  return grouped
}

function extractImageRelations(relXml: string): Map<string, string> {
  const relationMap = new Map<string, string>()
  if (!relXml) return relationMap
  const relPattern = /<Relationship[^>]+Id="([^"]+)"[^>]+Target="([^"]+)"/g
  let match: RegExpExecArray | null
  while ((match = relPattern.exec(relXml)) !== null) {
    relationMap.set(match[1], match[2])
  }
  return relationMap
}

function resolveDrawingTarget(basePath: string, target?: string): string {
  if (!target) return ''
  const baseParts = basePath.split('/').slice(0, -1)
  const targetParts = target.split('/')
  const parts = [...baseParts]

  for (const part of targetParts) {
    if (!part || part === '.') continue
    if (part === '..') {
      parts.pop()
      continue
    }
    parts.push(part)
  }
  return parts.join('/')
}

function readZipText(file: any): string {
  const buffer = readZipBuffer(file)
  return buffer.toString('utf8')
}

function readZipBuffer(file: any): Buffer {
  if (!file?.content) return Buffer.alloc(0)
  return Buffer.isBuffer(file.content) ? file.content : Buffer.from(file.content)
}

function guessImageMimeType(path: string): string {
  if (/\.jpe?g$/i.test(path)) return 'image/jpeg'
  if (/\.gif$/i.test(path)) return 'image/gif'
  if (/\.svg$/i.test(path)) return 'image/svg+xml'
  if (/\.webp$/i.test(path)) return 'image/webp'
  return 'image/png'
}

function emuToPx(emu: number): number {
  if (!emu) return 0
  return Math.round((emu * 96) / 914400)
}

function buildCompositeImage(images: SheetImage[]): string {
  if (images.length === 0) return ''
  if (images.length === 1) return images[0].dataUrl

  const sorted = [...images].sort((a, b) => a.col - b.col)
  const gap = 12
  const width = sorted.reduce((sum, image) => sum + image.widthPx, 0) + gap * (sorted.length - 1)
  const height = Math.max(...sorted.map((image) => image.heightPx))
  let cursorX = 0
  const imageNodes = sorted.map((image) => {
    const node = `<image href="${image.dataUrl}" x="${cursorX}" y="0" width="${image.widthPx}" height="${image.heightPx}" preserveAspectRatio="xMidYMid meet" />`
    cursorX += image.widthPx + gap
    return node
  }).join('')
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${imageNodes}</svg>`
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
}

function stackCompositeImages(images: string[]): string {
  const validImages = images.filter(Boolean)
  if (validImages.length === 0) return ''
  if (validImages.length === 1) return validImages[0]

  const gap = 16
  const imageNodes: string[] = []
  let cursorY = 0
  let maxWidth = 0

  for (const [index, image] of validImages.entries()) {
    const size = inferDataUrlSize(image)
    const width = size.width || 720
    const height = size.height || 240
    maxWidth = Math.max(maxWidth, width)
    imageNodes.push(`<image href="${image}" x="0" y="${cursorY}" width="${width}" height="${height}" preserveAspectRatio="xMinYMin meet" />`)
    cursorY += height
    if (index < validImages.length - 1) cursorY += gap
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${maxWidth}" height="${cursorY}" viewBox="0 0 ${maxWidth} ${cursorY}">${imageNodes.join('')}</svg>`
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
}

function inferDataUrlSize(dataUrl: string): { width: number; height: number } {
  if (!dataUrl.startsWith('data:image/svg+xml;base64,')) return { width: 0, height: 0 }
  try {
    const encoded = dataUrl.slice('data:image/svg+xml;base64,'.length)
    const svg = Buffer.from(encoded, 'base64').toString('utf8')
    const width = Number(svg.match(/width="(\d+)"/)?.[1] || 0)
    const height = Number(svg.match(/height="(\d+)"/)?.[1] || 0)
    return { width, height }
  } catch {
    return { width: 0, height: 0 }
  }
}
