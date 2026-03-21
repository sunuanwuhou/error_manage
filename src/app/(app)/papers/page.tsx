import Link from 'next/link'
import { getServerSession } from 'next-auth'
import { getPaperCatalog } from '@/lib/papers'
import { authOptions } from '@/lib/auth'
import { DeletePaperButton } from '@/components/papers/delete-paper-button'

const EXAM_TYPE_LABELS: Record<string, string> = {
  guo_kao: '国考',
  sheng_kao: '省考',
  tong_kao: '统考',
  common: '通用',
}

export default async function PapersPage({
  searchParams,
}: {
  searchParams?: { examType?: string; province?: string; year?: string }
}) {
  const session = await getServerSession(authOptions)
  const isAdmin = (session?.user as { role?: string } | undefined)?.role === 'admin'
  const activeExamType = searchParams?.examType
  const activeProvince = searchParams?.province
  const activeYear = searchParams?.year
  const { papers, examTypes, provinces, years, error } = await getPaperCatalog({
    examType: activeExamType,
    province: activeProvince,
    year: activeYear,
  })
  const hasActiveFilters = Boolean(activeExamType || activeProvince || activeYear)

  function buildHref(next: { examType?: string; province?: string; year?: string }) {
    const params = new URLSearchParams()
    if (next.examType) params.set('examType', next.examType)
    if (next.province) params.set('province', next.province)
    if (next.year) params.set('year', next.year)
    const query = params.toString()
    return query ? `/papers?${query}` : '/papers'
  }

  return (
    <div data-testid="papers-page" className="max-w-lg mx-auto px-4 pt-4 pb-8">
      <div className="mb-6 lg:flex lg:items-end lg:justify-between">
        <h1 className="text-xl font-bold text-gray-900">套卷练习</h1>
        <p className="text-xs text-gray-400 mt-0.5">按来源、年份、省份聚合，整套开始练</p>
      </div>

      <div className="space-y-3 mb-4">
        <div className="flex gap-2 overflow-x-auto pb-1">
          <Link href={buildHref({ province: activeProvince, year: activeYear })} className={`whitespace-nowrap rounded-full px-3 py-1.5 text-xs ${!activeExamType ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600'}`}>
            全部考试
          </Link>
          {examTypes.map(type => (
            <Link
              key={type}
              href={buildHref({ examType: type, province: activeProvince, year: activeYear })}
              className={`whitespace-nowrap rounded-full px-3 py-1.5 text-xs ${activeExamType === type ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600'}`}
            >
              {EXAM_TYPE_LABELS[type] ?? type}
            </Link>
          ))}
        </div>

        {provinces.length > 0 && (
          <div className="flex gap-2 overflow-x-auto pb-1">
            <Link
              href={buildHref({ examType: activeExamType, year: activeYear })}
              className={`whitespace-nowrap rounded-full px-3 py-1.5 text-xs ${!activeProvince ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600'}`}
            >
              全部省份
            </Link>
            {provinces.map(province => (
              <Link
                key={province}
                href={buildHref({ examType: activeExamType, province, year: activeYear })}
                className={`whitespace-nowrap rounded-full px-3 py-1.5 text-xs ${activeProvince === province ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600'}`}
              >
                {province}
              </Link>
            ))}
          </div>
        )}

        {years.length > 0 && (
          <div className="flex gap-2 overflow-x-auto pb-1">
            <Link
              href={buildHref({ examType: activeExamType, province: activeProvince })}
              className={`whitespace-nowrap rounded-full px-3 py-1.5 text-xs ${!activeYear ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600'}`}
            >
              全部年份
            </Link>
            {years.map(year => (
              <Link
                key={year}
                href={buildHref({ examType: activeExamType, province: activeProvince, year })}
                className={`whitespace-nowrap rounded-full px-3 py-1.5 text-xs ${activeYear === year ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600'}`}
              >
                {year}
              </Link>
            ))}
          </div>
        )}
      </div>

      {error ? (
        <div data-testid="papers-error" className="bg-red-50 border border-red-200 rounded-2xl p-4 text-sm text-red-600">
          <p className="font-medium">套卷列表加载失败</p>
          <p className="mt-1">{error}</p>
          <Link href="/papers" className="inline-flex mt-4 px-4 py-2 bg-white border border-red-200 text-red-600 rounded-xl text-sm font-medium">
            重新加载
          </Link>
        </div>
      ) : papers.length === 0 ? (
        <div data-testid="papers-empty" className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 text-center">
          <p className="text-4xl mb-3">📚</p>
          <p className="font-medium text-gray-800">{hasActiveFilters ? '没有符合当前筛选的套卷' : '还没有可练的套卷'}</p>
          <p className="text-sm text-gray-400 mt-1">
            {hasActiveFilters ? '试试清除筛选，或者换一个年份/地区。' : '先去导入真题，系统会自动按来源或年份归组'}
          </p>
          <div className="mt-4 space-y-3">
            {hasActiveFilters && (
              <Link href="/papers" className="inline-flex px-4 py-2 bg-gray-100 text-gray-700 rounded-xl text-sm font-medium">
                清除筛选
              </Link>
            )}
            <Link href="/import" className="inline-flex px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-medium">
              去导入
            </Link>
          </div>
        </div>
      ) : (
        <div data-testid="papers-list" className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
          {papers.map(paper => (
            <div key={paper.key} data-testid="paper-card" className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p data-testid="paper-card-title" className="font-semibold text-gray-900 text-sm">{paper.title}</p>
                  <p className="text-xs text-gray-400 mt-1">
                    {paper.srcYear ? `${paper.srcYear} · ` : ''}
                    {paper.srcProvince
                      ? `${EXAM_TYPE_LABELS[paper.examType] ?? paper.examType}/${paper.srcProvince}`
                      : (EXAM_TYPE_LABELS[paper.examType] ?? paper.examType)}
                  </p>
                  {paper.sessionLabel ? (
                    <p className="text-[11px] text-gray-300 mt-1 line-clamp-1">{paper.sessionLabel}</p>
                  ) : null}
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-lg font-bold text-blue-600">{paper.questionCount}</p>
                  <p className="text-xs text-gray-400">题</p>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                <span className="rounded-full bg-gray-50 px-2.5 py-1 text-xs text-gray-500 border border-gray-100">
                  {(EXAM_TYPE_LABELS[paper.examType] ?? paper.examType) + (paper.srcProvince ? ` / ${paper.srcProvince}` : '')}
                </span>
                {paper.srcYear && (
                  <span className="rounded-full bg-gray-50 px-2.5 py-1 text-xs text-gray-500 border border-gray-100">
                    {paper.srcYear} 年
                  </span>
                )}
                <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs text-blue-600 border border-blue-100">
                  整卷模式
                </span>
              </div>

              <div className="mt-4">
                <Link
                  data-testid="paper-card-start"
                  href={`/practice?paper=${encodeURIComponent(paper.key)}`}
                  className="block w-full py-3 bg-blue-600 text-white text-center rounded-xl text-sm font-medium"
                >
                  开始整套练习
                </Link>
                {isAdmin ? (
                  <DeletePaperButton
                    paperKey={paper.key}
                    paperTitle={paper.title}
                    questionCount={paper.questionCount}
                  />
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
