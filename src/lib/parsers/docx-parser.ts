// src/lib/parsers/docx-parser.ts
// ============================================================
// DOCX 真题解析器
// 基于 mammoth HTML 输出，保留题干图片、材料图、图形选项和内联公式图
// ============================================================

import mammoth from 'mammoth'
// @ts-ignore Node strip-types tests need explicit .ts extensions for ESM resolution.
import type { ParsedQuestion } from './pdf-parser.ts'
// @ts-ignore Node strip-types tests need explicit .ts extensions for ESM resolution.
import { inferExcelQuestionType } from './excel-parser.ts'

type HtmlBlock = {
  html: string
  text: string
  images: string[]
}

type DraftQuestion = {
  no: string
  contentParts: string[]
  questionImages: string[]
  optionImages: string[]
  options: string[]
  answer: string
  type: string
  analysis: string
  rawBlocks: string[]
  inheritedMaterialBlocks: HtmlBlock[]
}

const INLINE_IMAGE_TOKEN = '[图]'

export async function parseDocxBuffer(buffer: Buffer): Promise<{
  questions: ParsedQuestion[]
  warnings: string[]
}> {
  const warnings: string[] = []

  const result = await mammoth.convertToHtml(
    { buffer },
    {
      convertImage: mammoth.images.imgElement(async (image: any) => {
        const base64 = await image.read('base64')
        return { src: `data:${image.contentType};base64,${base64}` }
      }),
    }
  )

  const html = String(result.value || '').trim()
  if (!html) {
    warnings.push('DOCX 文件为空或未提取到内容')
    return { questions: [], warnings }
  }

  const parsed = parseDocxHtml(html)
  const mammothWarnings = (result.messages || [])
    .map((message) => String(message.message || '').trim())
    .filter(Boolean)

  return {
    questions: parsed.questions,
    warnings: [...warnings, ...mammothWarnings, ...parsed.warnings],
  }
}

export function parseDocxHtml(html: string): {
  questions: ParsedQuestion[]
  warnings: string[]
} {
  const warnings: string[] = []
  const blocks = extractHtmlBlocks(html)

  if (blocks.length === 0) {
    warnings.push('DOCX HTML 中未找到可解析段落')
    return { questions: [], warnings }
  }

  const questions: ParsedQuestion[] = []
  let currentSectionType = ''
  let pendingMaterialBlocks: HtmlBlock[] = []
  let materialCaptureArmed = false
  let currentQuestion: DraftQuestion | null = null

  const flushCurrentQuestion = () => {
    if (!currentQuestion) return
    const finalized = finalizeQuestion(currentQuestion)
    if (finalized.content.length > 5) {
      questions.push(finalized)
    }
    currentQuestion = null
  }

  for (const block of blocks) {
    if (!block.text && block.images.length === 0) continue

    const questionStart = extractQuestionStart(block.text)
    if (questionStart) {
      flushCurrentQuestion()

      const inferredType = inferExcelQuestionType({
        currentSectionType,
        content: questionStart.content,
      })
      const inheritedMaterialBlocks = shouldAttachMaterial({
        currentSectionType,
        inferredType,
        pendingMaterialBlocks,
        questionText: questionStart.content,
      })
        ? [...pendingMaterialBlocks]
        : []

      currentQuestion = {
        no: questionStart.no,
        contentParts: [questionStart.content],
        questionImages: [...block.images],
        optionImages: [],
        options: [],
        answer: '',
        type: inferredType,
        analysis: '',
        rawBlocks: [block.text],
        inheritedMaterialBlocks,
      }
      materialCaptureArmed = false
      continue
    }

    if (isSectionHeaderBlock(block.text)) {
      flushCurrentQuestion()
      currentSectionType = inferExcelQuestionType({
        content: block.text,
      })
      pendingMaterialBlocks = []
      materialCaptureArmed = currentSectionType === '资料分析'
      continue
    }

    if (isSeparatorBlock(block.text)) {
      if (currentQuestion) {
        flushCurrentQuestion()
      }
      materialCaptureArmed = currentSectionType === '资料分析'
      continue
    }

    if (currentQuestion) {
      currentQuestion.rawBlocks.push(block.text)

      const answerMeta = parseAnswerMeta(block.text)
      if (answerMeta) {
        currentQuestion.answer = currentQuestion.answer || answerMeta.answer
        if (answerMeta.point) {
          const inferredFromPoint = inferExcelQuestionType({
            explicitType: answerMeta.point,
            currentSectionType,
            content: currentQuestion.contentParts.join(' '),
            skillTag: answerMeta.point,
          })
          if (isKnownQuestionType(inferredFromPoint)) {
            currentQuestion.type = inferredFromPoint
          }
        }
        continue
      }

      const option = parseOptionBlock(block)
      if (option) {
        currentQuestion.options.push(option.label)
        if (option.imageForQuestion) {
          currentQuestion.optionImages.push(option.imageForQuestion)
        }
        continue
      }

      if (block.text) currentQuestion.contentParts.push(block.text)
      if (block.images.length > 0) currentQuestion.questionImages.push(...block.images)
      continue
    }

    if (
      currentSectionType === '资料分析' &&
      isLikelyMaterialBlock(block, materialCaptureArmed, pendingMaterialBlocks.length > 0)
    ) {
      if (materialCaptureArmed) pendingMaterialBlocks = []
      pendingMaterialBlocks.push(block)
      materialCaptureArmed = false
      continue
    }
  }

  flushCurrentQuestion()

  if (questions.length === 0) {
    warnings.push('DOCX 未解析出有效题目')
  }

  return { questions, warnings }
}

function extractHtmlBlocks(html: string): HtmlBlock[] {
  const blocks: HtmlBlock[] = []
  const paragraphPattern = /<p[^>]*>([\s\S]*?)<\/p>/gi
  let match: RegExpExecArray | null

  while ((match = paragraphPattern.exec(html)) !== null) {
    const body = match[1]
    const images = [...body.matchAll(/<img[^>]+src="([^"]+)"/gi)].map((item) => item[1])
    const textWithTokens = body.replace(/<img[^>]*>/gi, ` ${INLINE_IMAGE_TOKEN} `)
    const text = sanitizeHtmlText(textWithTokens)
    blocks.push({
      html: body,
      text,
      images,
    })
  }

  return blocks
}

function sanitizeHtmlText(html: string): string {
  return decodeHtmlEntities(
    html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/?(strong|b|em|span|u)[^>]*>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  )
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&ensp;|&emsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function extractQuestionStart(text: string): { no: string; content: string } | null {
  const match = text.match(/^(\d{1,3})[.、．]\s*(.+)$/)
  if (!match) return null
  return {
    no: match[1],
    content: match[2].trim(),
  }
}

function isSectionHeaderBlock(text: string): boolean {
  return /第[一二三四五六七八九十\d]+部分|常识判断|言语理解与表达|数量关系|判断推理|资料分析/.test(text)
    && !/^(\d{1,3})[.、．]/.test(text)
}

function isSeparatorBlock(text: string): boolean {
  return /^[-=]{8,}$/.test(text)
}

function parseAnswerMeta(text: string): { answer: string; point: string } | null {
  if (!/正确答案[:：]/.test(text)) return null
  const answer = normalizeAnswer(text.match(/正确答案[:：]\s*([ABCD])/i)?.[1] || '')
  const point = String(text.match(/考点[:：]\s*([^|]+?)(?:自定义备注|$)/)?.[1] || '').trim()
  return { answer, point }
}

function parseOptionBlock(block: HtmlBlock): { label: string; imageForQuestion: string } | null {
  const match = block.text.match(/^([ABCD])[.、．]\s*(.*)$/)
  if (!match) return null

  const letter = match[1]
  const rawText = match[2].trim()
  const normalized = normalizeOptionText(rawText)
  const shouldCollapseToImage = block.images.length > 0 && (!normalized || normalized === letter)
  const label = shouldCollapseToImage || !normalized ? `${letter}.见图` : `${letter}.${normalized}`
  const imageForQuestion = block.images.length > 0 ? buildInlineImageStrip(block.images) : ''

  return { label, imageForQuestion }
}

function normalizeOptionText(text: string): string {
  if (!text) return ''
  const cleaned = text.replace(new RegExp(`^${escapeRegExp(INLINE_IMAGE_TOKEN)}$`), '见图')
  const normalized = cleaned
    .replace(new RegExp(escapeRegExp(INLINE_IMAGE_TOKEN), 'g'), '见图')
    .replace(/\s+/g, ' ')
    .trim()

  if (!normalized || normalized === '见图') return ''
  return normalized
}

function normalizeAnswer(raw: string): string {
  const upper = String(raw || '').toUpperCase().replace(/[（()）\s]/g, '')
  const match = upper.match(/[ABCD]/)
  return match?.[0] ?? ''
}

function isKnownQuestionType(type: string): boolean {
  return ['常识判断', '言语理解', '数量关系', '判断推理', '资料分析'].includes(type)
}

function shouldAttachMaterial(params: {
  currentSectionType: string
  inferredType: string
  pendingMaterialBlocks: HtmlBlock[]
  questionText: string
}) {
  const { currentSectionType, inferredType, pendingMaterialBlocks, questionText } = params
  if (pendingMaterialBlocks.length === 0) return false
  if (currentSectionType === '资料分析' || inferredType === '资料分析') return true
  return /根据以下资料|根据所给资料|基于上述资料/.test(questionText)
}

function isLikelyMaterialBlock(
  block: HtmlBlock,
  materialCaptureArmed: boolean,
  hasPendingMaterial: boolean
): boolean {
  if (block.images.length > 0) return true
  if (!block.text) return false
  if (materialCaptureArmed) return true
  if (hasPendingMaterial) return true
  return block.text.length >= 20 && !/^[ABCD][.、．]/.test(block.text)
}

function finalizeQuestion(draft: DraftQuestion): ParsedQuestion {
  const materialText = draft.inheritedMaterialBlocks
    .map((block) => block.text.replace(new RegExp(escapeRegExp(INLINE_IMAGE_TOKEN), 'g'), '').trim())
    .filter(Boolean)
    .join('\n')

  const questionText = draft.contentParts
    .map((part) => normalizeQuestionText(part))
    .filter(Boolean)
    .join(' ')
    .trim()

  const mergedContent = materialText
    ? `【资料】${materialText}\n\n${questionText}`
    : questionText

  const rawQuestionImage = stackCompositeImages([
    ...draft.inheritedMaterialBlocks.flatMap((block) => block.images),
    ...draft.questionImages,
    ...draft.optionImages,
  ])
  const fixedContent = applyKnownQuestionTextFixes(mergedContent)
  const normalizedOptions = normalizeQuestionOptions(draft.options, Boolean(rawQuestionImage))
  const questionImage = shouldKeepQuestionImage({
    content: fixedContent,
    questionImage: rawQuestionImage,
    options: normalizedOptions,
    type: draft.type,
  }) ? rawQuestionImage : ''

  return {
    no: draft.no,
    content: fixedContent,
    questionImage,
    options: normalizedOptions,
    answer: draft.answer,
    type: draft.type || inferExcelQuestionType({ content: mergedContent }),
    analysis: draft.analysis,
    rawText: draft.rawBlocks.join('\n'),
  }
}

function shouldKeepQuestionImage(params: {
  content: string
  questionImage: string
  options: string[]
  type: string
}) {
  const { content, questionImage, options, type } = params
  if (!questionImage) return false
  if (type === '资料分析') return true
  if (/\[图\]|见上图|见下图|见图|如下图|如下表/.test(content)) return true
  if (options.some((option) => /见图|\[图/.test(option))) return true

  const size = inferDataUrlSize(questionImage)
  const looksTinyInlineImage = size.width > 0 && size.height > 0 && size.width <= 120 && size.height <= 120
  return !looksTinyInlineImage
}

function normalizeQuestionOptions(options: string[], hasQuestionImage: boolean): string[] {
  return options.map((option) => {
    if (hasQuestionImage && /^([A-D])\.\1$/.test(option)) {
      return option.replace(/^([A-D])\.\1$/, '$1.见图')
    }
    if (hasQuestionImage && /\[图[A-D]?\]/.test(option)) {
      return option.replace(/\[图[A-D]?\]/g, '见图')
    }
    return option
  })
}

function normalizeQuestionText(text: string): string {
  return text
    .replace(/正确答案[:：].*$/g, '')
    .replace(/考点[:：].*$/g, '')
    .replace(new RegExp(`${escapeRegExp(INLINE_IMAGE_TOKEN)}+`, 'g'), INLINE_IMAGE_TOKEN)
    .replace(/\s+/g, ' ')
    .trim()
}

function applyKnownQuestionTextFixes(text: string): string {
  if (!text) return text

  return text
    .replace(
      /每个办事窗口办理每笔业务的用时缩短到以前的\s*(?:\[图\]|见图)\s*/gi,
      '每个办事窗口办理每笔业务的用时缩短到以前的2/3'
    )
    .replace(/\s+/g, ' ')
    .trim()
}

function buildInlineImageStrip(images: string[]): string {
  return stackCompositeImages(images)
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
  if (dataUrl.startsWith('data:image/svg+xml;base64,')) {
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

  try {
    const match = dataUrl.match(/^data:image\/(?:png|jpeg|jpg|gif|webp);base64,(.+)$/i)
    if (!match) return { width: 0, height: 0 }
    const buffer = Buffer.from(match[1], 'base64')
    if (buffer.length < 24) return { width: 0, height: 0 }

    if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
      return {
        width: buffer.readUInt32BE(16),
        height: buffer.readUInt32BE(20),
      }
    }

    if (buffer[0] === 0xff && buffer[1] === 0xd8) {
      let offset = 2
      while (offset < buffer.length) {
        if (buffer[offset] !== 0xff) break
        const marker = buffer[offset + 1]
        const length = buffer.readUInt16BE(offset + 2)
        if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
          return {
            height: buffer.readUInt16BE(offset + 5),
            width: buffer.readUInt16BE(offset + 7),
          }
        }
        offset += 2 + length
      }
    }

    if (buffer.toString('ascii', 0, 3) === 'GIF') {
      return {
        width: buffer.readUInt16LE(6),
        height: buffer.readUInt16LE(8),
      }
    }

    if (buffer.toString('ascii', 8, 12) === 'WEBP') {
      const chunk = buffer.toString('ascii', 12, 16)
      if (chunk === 'VP8X') {
        return {
          width: 1 + buffer.readUIntLE(24, 3),
          height: 1 + buffer.readUIntLE(27, 3),
        }
      }
    }

    return { width: 0, height: 0 }
  } catch {
    return { width: 0, height: 0 }
  }
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
