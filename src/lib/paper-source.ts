export interface PaperSourceMetaInput {
  fileName?: string
  srcName?: string
}

const PROVINCE_ALIASES: Array<[string, string]> = [
  ['北京', '北京'], ['天津', '天津'], ['上海', '上海'], ['重庆', '重庆'],
  ['河北', '河北'], ['山西', '山西'], ['内蒙古', '内蒙古'], ['辽宁', '辽宁'],
  ['吉林', '吉林'], ['黑龙江', '黑龙江'], ['江苏', '江苏'], ['浙江', '浙江'],
  ['安徽', '安徽'], ['福建', '福建'], ['江西', '江西'], ['山东', '山东'],
  ['河南', '河南'], ['湖北', '湖北'], ['湖南', '湖南'], ['广东', '广东'],
  ['广西', '广西'], ['海南', '海南'], ['四川', '四川'], ['贵州', '贵州'],
  ['云南', '云南'], ['西藏', '西藏'], ['陕西', '陕西'], ['甘肃', '甘肃'],
  ['青海', '青海'], ['宁夏', '宁夏'], ['新疆', '新疆'],
]

function normalizeName(input: string) {
  return String(input || '')
    .replace(/\.[^.]+$/, '')
    .replace(/[【】\[\]()（）]/g, ' ')
    .replace(/[—_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function inferPaperSourceMeta(input: PaperSourceMetaInput) {
  const base = normalizeName(String(input.srcName || input.fileName || ''))

  const yearMatch =
    base.match(/\b(20\d{2})\b/) ||
    base.match(/(20\d{2})年/) ||
    base.match(/(^|\D)(20\d{2})(?=\D|$)/)

  const srcYear = yearMatch?.[1] || yearMatch?.[2] || ''

  let examType = 'common'
  if (/国考|国家公务员|国家公务员考试/.test(base)) examType = 'guo_kao'
  else if (/联考|统考/.test(base)) examType = 'tong_kao'
  else if (/省考/.test(base)) examType = 'sheng_kao'

  let srcProvince = ''
  for (const [alias, normalized] of PROVINCE_ALIASES) {
    if (base.includes(alias)) {
      srcProvince = normalized
      break
    }
  }

  let srcSession = ''
  if (/上午/.test(base)) srcSession = '上午'
  else if (/下午/.test(base)) srcSession = '下午'

  let srcPaperCode = ''
  if (/A卷|A/.test(base)) srcPaperCode = 'A卷'
  else if (/B卷|B/.test(base)) srcPaperCode = 'B卷'

  let postHint = ''
  if (/行政执法/.test(base)) postHint = '行政执法'

  return {
    srcName: base,
    srcYear,
    srcProvince,
    examType,
    srcSession,
    srcPaperCode,
    postHint,
  }
}

export function inferPaperYear(srcExamSession?: string | null) {
  return inferPaperSourceMeta({ srcName: srcExamSession ?? '' }).srcYear || null
}

export function inferPaperProvince(srcExamSession?: string | null) {
  return inferPaperSourceMeta({ srcName: srcExamSession ?? '' }).srcProvince || null
}

export function inferPaperExamType(srcExamSession?: string | null) {
  return inferPaperSourceMeta({ srcName: srcExamSession ?? '' }).examType || 'common'
}

type CanonicalPaperInput = {
  srcExamSession?: string | null
  srcYear?: string | null
  srcProvince?: string | null
  examType?: string | null
}

function examTypeLabel(examType?: string | null) {
  if (examType === 'guo_kao') return '国考'
  if (examType === 'sheng_kao') return '省考'
  if (examType === 'tong_kao') return '联考'
  return '通用'
}

export function buildCanonicalPaperSession(input: CanonicalPaperInput) {
  const meta = inferPaperSourceMeta({ srcName: input.srcExamSession ?? '' })
  const year = input.srcYear || meta.srcYear || ''
  const province = input.srcProvince || meta.srcProvince || ''
  const examType = input.examType || meta.examType || 'common'
  const raw = String(input.srcExamSession || '').trim()

  if (raw) return raw

  return [year, province, examTypeLabel(examType)]
    .filter(Boolean)
    .join(' ')
    .trim()
}

export function buildCanonicalPaperTitle(input: CanonicalPaperInput) {
  const session = buildCanonicalPaperSession(input)
  if (!session) return '未命名套卷'

  return session
    .replace(/\s+/g, ' ')
    .trim()
}
