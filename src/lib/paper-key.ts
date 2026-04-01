export function buildPaperKey(input: {
  srcYear?: string | null
  srcProvince?: string | null
  examType?: string | null
}) {
  const year = String(input.srcYear || '').trim()
  const province = String(input.srcProvince || '').trim()
  const examType = String(input.examType || '').trim()

  if (!year && !province && !examType) return 'manual-practice'
  return [year || 'unknown', province || 'common', examType || 'common'].join('__')
}
