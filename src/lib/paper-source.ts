export const PROVINCES = [
  '北京', '天津', '上海', '重庆', '河北', '河南', '云南', '辽宁', '黑龙江', '湖南',
  '安徽', '山东', '新疆', '江苏', '浙江', '江西', '湖北', '广西', '甘肃', '山西',
  '内蒙古', '陕西', '吉林', '福建', '贵州', '广东', '青海', '西藏', '四川', '宁夏',
  '海南',
] as const

export type ExamType = 'guo_kao' | 'sheng_kao' | 'tong_kao' | 'common'

export interface PaperSourceMeta {
  normalizedName: string
  srcName: string
  srcYear: string
  srcProvince: string
  examType: ExamType
  specialization: string
}

const FILE_EXT_RE = /\.(pdf|docx|doc|xlsx|xls|csv)$/i
const PAGE_NOISE_RE = /^(?:[·•]\s*)?本试卷由.+?第\s*\d+\s*页.*$/i

function normalizeWhitespace(input: string) {
  return input
    .replace(/\r/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function stripPaperFileExtension(input: string) {
  return input.replace(FILE_EXT_RE, '').trim()
}

export function normalizePaperSourceName(input: string) {
  return normalizeWhitespace(stripPaperFileExtension(input))
    .replace(/《\s*/g, '《')
    .replace(/\s*》/g, '》')
    .replace(/\s*（/g, '（')
    .replace(/）\s*/g, '）')
    .replace(/\s{2,}/g, ' ')
}

export function extractPaperTitleFromText(rawText: string) {
  const lines = normalizeWhitespace(rawText)
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .filter(line => !PAGE_NOISE_RE.test(line))

  const title = lines.find(line => /20\d{2}年/.test(line) && /试卷|真题/.test(line))
  return title ? normalizePaperSourceName(title) : ''
}

export function inferPaperYear(...candidates: Array<string | null | undefined>) {
  for (const candidate of candidates) {
    if (!candidate) continue
    const match = candidate.match(/(20\d{2})/)
    if (match?.[1]) return match[1]
  }
  return ''
}

export function inferPaperProvince(...candidates: Array<string | null | undefined>) {
  for (const candidate of candidates) {
    if (!candidate) continue
    const province = PROVINCES.find(name => candidate.includes(name))
    if (province) return province
  }
  return ''
}

export function inferPaperSpecialization(...candidates: Array<string | null | undefined>) {
  for (const candidate of candidates) {
    if (!candidate) continue
    const bracket = candidate.match(/《([^》]+)》/)
    if (bracket?.[1]) return normalizePaperSourceName(bracket[1])
    const keyword = candidate.match(/行政执法专业|公安专业科目|申论|行测|职业能力测验|综合应用能力|专业科目/)
    if (keyword?.[0]) return keyword[0]
  }
  return ''
}

export function inferPaperExamType(...candidates: Array<string | null | undefined>): ExamType {
  for (const candidate of candidates) {
    if (!candidate) continue
    if (/国考|国家公务员/.test(candidate)) return 'guo_kao'
    if (/联考|统考|多省联考/.test(candidate)) return 'tong_kao'
    if (/省考/.test(candidate)) return 'sheng_kao'
    if (/(省|市|自治区).*(公务员|录用考试)/.test(candidate) && !/国家/.test(candidate)) return 'sheng_kao'
  }
  return 'common'
}

export function inferPaperSourceMeta(params: {
  fileName?: string | null
  srcName?: string | null
  rawText?: string | null
}): PaperSourceMeta {
  const fileName = normalizePaperSourceName(params.fileName ?? '')
  const srcName = normalizePaperSourceName(params.srcName ?? '')
  const titleFromText = params.rawText ? extractPaperTitleFromText(params.rawText) : ''
  const normalizedName = srcName || titleFromText || fileName

  return {
    normalizedName,
    srcName: normalizedName,
    srcYear: inferPaperYear(srcName, titleFromText, fileName),
    srcProvince: inferPaperProvince(srcName, titleFromText, fileName),
    examType: inferPaperExamType(srcName, titleFromText, fileName),
    specialization: inferPaperSpecialization(srcName, titleFromText, fileName),
  }
}

export function buildCanonicalPaperTitle(params: {
  srcExamSession?: string | null
  srcYear?: string | null
  srcProvince?: string | null
  examType?: string | null
}) {
  const normalizedSession = normalizePaperSourceName(params.srcExamSession ?? '')
  if (normalizedSession) return normalizedSession

  const inferred = inferPaperSourceMeta({
    srcName: normalizedSession,
  })

  const typeLabel =
    params.examType === 'guo_kao' ? '国考' :
    params.examType === 'sheng_kao' ? '省考' :
    params.examType === 'tong_kao' ? '统考' :
    ''

  return [
    params.srcYear || inferred.srcYear,
    params.srcProvince || inferred.srcProvince,
    inferred.specialization,
    typeLabel,
    '真题',
  ]
    .filter(Boolean)
    .join(' ')
    .trim()
}
